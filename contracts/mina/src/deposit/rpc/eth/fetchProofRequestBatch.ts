import { Contract } from 'ethers';
import {
    NoriProofRequestQueue__factory,
    NoriTokenBridge__factory,
} from '@nori-zk/ethereum-token-bridge';
import {
    getEthereumProvider,
    type EthereumProvider,
} from '@nori-zk/ethers-iso-provider';
import {
    EthCallFailedError,
    EthRpcTransportError,
    MalformedProofRequestError,
    ProofRequestBatchFetchError,
    type ProofRequestBatchFailure,
    type ProofRequestFailureCause,
} from './errors.js';

/**
 * Canonical Multicall3 deployment address, identical across virtually every
 * EVM chain. See https://www.multicall3.com/
 */
const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11';

const MULTICALL3_ABI = [
    'function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) payable returns (tuple(bool success, bytes returnData)[] returnData)',
];

interface Multicall3Result {
    success: boolean;
    returnData: string;
}

/**
 * Max entries per `aggregate3` call. Kept conservative against `eth_call` gas
 * caps: each `requests(id)` read touches a distinct storage slot every time
 * (no warm-slot reuse across entries), and a `Request` is 5 words, so it costs
 * 5 cold SLOADs (roughly 10.5k gas floor) plus per-call overhead. This stays
 * well under a typical 25 to 50 million gas `eth_call` ceiling.
 */
const RECORDS_PER_MULTICALL = 200;

/**
 * Concurrency for the raw-storage fallback path (queue consumers other than
 * the bridge). This can't be folded into Multicall3, since a contract can
 * only read its own storage, not an arbitrary target's, so it goes through
 * the provider's own transport one call at a time. Kept low since this is
 * expected to run against a wallet's default provider, not a dedicated
 * endpoint.
 */
const FALLBACK_CONCURRENCY = 8;

const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 500;

export interface ProofRequestBatchEntry {
    target: string;
    collectionKeysCount: number;
    collectionKeys: string[];
    value: string;
}

interface ProofRequestRecord {
    id: bigint;
    target: string;
    slotKey: string;
    collectionKeysCount: number;
    collectionKeys: string[];
}

function chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
}

/**
 * Only these are treated as transient. Mirrors rpc/mina/apiDecorator.ts's
 * `shouldTryFallback`: everything else fails immediately rather than being
 * retried, since retrying an identical call that reverted or was rejected for
 * a non-transient reason just produces the same failure again.
 */
function isTransportError(error: unknown): boolean {
    const code = (error as { code?: string } | undefined)?.code;
    if (code === 'SERVER_ERROR' || code === 'TIMEOUT' || code === 'NETWORK_ERROR') {
        return true;
    }
    const status = (error as { info?: { responseStatus?: string } } | undefined)?.info
        ?.responseStatus;
    return status !== undefined && (status.startsWith('429') || status.startsWith('5'));
}

/**
 * Retries `fn` with exponential backoff and jitter, but only for errors
 * `isTransportError` recognises as transient. Always throws a typed error:
 * `EthCallFailedError` immediately for anything else, or `EthRpcTransportError`
 * once retries are exhausted.
 */
async function withBackoff<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
        try {
            return await fn();
        } catch (error) {
            if (!isTransportError(error)) {
                throw new EthCallFailedError('Ethereum call failed.', error);
            }
            if (attempt >= MAX_RETRIES) {
                throw new EthRpcTransportError(
                    `Ethereum RPC transport failed after ${MAX_RETRIES} retries.`,
                    error
                );
            }
            const delay = BASE_BACKOFF_MS * 2 ** attempt * (0.75 + Math.random() * 0.5);
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }
}

/**
 * Runs `fn` over `items` with at most `limit` concurrent in flight. A failure
 * on one item (after its own retries are exhausted) is reported to
 * `onFailure` rather than aborting the others, so a single bad item doesn't
 * discard results already fetched for the rest of the batch.
 */
async function mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>,
    onFailure: (item: T, error: unknown) => void
): Promise<(R | undefined)[]> {
    const results: (R | undefined)[] = new Array(items.length);
    let cursor = 0;
    async function worker() {
        while (cursor < items.length) {
            const index = cursor++;
            try {
                results[index] = await withBackoff(() => fn(items[index]));
            } catch (error) {
                onFailure(items[index], error);
            }
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}

/**
 * Reads every `NoriProofRequestQueue` entry with id in
 * `[inputQueueCursor, outputQueueCursor)`, plus the raw storage word each
 * one's `slotKey` points at, at `outputBlockNumber`.
 *
 * @param proofQueueAddress The `NoriProofRequestQueue` address.
 * @param bridgeAddress The `NoriTokenBridge` address. Requests whose `target`
 *   matches this address have their value read via `lockedTokens`, batched
 *   into the same Multicall3 call as the request record. Every other target
 *   falls back to a raw per-entry storage read.
 * @param inputQueueCursor Inclusive lower bound of the batch (queue request id).
 * @param outputQueueCursor Exclusive upper bound of the batch.
 * @param outputBlockNumber The Ethereum block to read at.
 * @param provider The Ethereum provider used for every read.
 * @returns One entry per request in the batch, in queue order.
 * @throws {ProofRequestBatchFetchError} If any request in the batch could not
 *   be read; lists every failed id and its cause.
 */
export async function fetchProofRequestBatch(
    proofQueueAddress: string,
    bridgeAddress: string,
    inputQueueCursor: bigint,
    outputQueueCursor: bigint,
    outputBlockNumber: number,
    provider: EthereumProvider = getEthereumProvider()
): Promise<ProofRequestBatchEntry[]> {
    const count = outputQueueCursor - inputQueueCursor;
    if (count <= 0n) return [];

    const queue = NoriProofRequestQueue__factory.connect(proofQueueAddress, provider);
    const bridge = NoriTokenBridge__factory.connect(bridgeAddress, provider);
    const multicall = new Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, provider);

    const ids = Array.from(
        { length: Number(count) },
        (_unused, k) => inputQueueCursor + BigInt(k)
    );

    const failures: ProofRequestBatchFailure[] = [];

    // Read every request record, chunked to stay under eth_call gas caps. A
    // chunk that fails after retries is recorded and skipped rather than
    // aborting the records already read from other chunks.
    const records: ProofRequestRecord[] = [];
    for (const idChunk of chunk(ids, RECORDS_PER_MULTICALL)) {
        try {
            const calls = idChunk.map((id) => ({
                target: proofQueueAddress,
                allowFailure: false,
                callData: queue.interface.encodeFunctionData('requests', [id]),
            }));
            const aggregated: Multicall3Result[] = await withBackoff(() =>
                multicall.aggregate3.staticCall(calls, { blockTag: outputBlockNumber })
            );
            aggregated.forEach(({ returnData }, i) => {
                const id = idChunk[i];
                const [request] = queue.interface.decodeFunctionResult('requests', returnData);
                const collectionKeysCount = Number(request.collectionKeysCount);
                if (collectionKeysCount === 0) {
                    failures.push({
                        requestIds: [id],
                        error: new MalformedProofRequestError(
                            id,
                            `Proof request ${id} has no collection keys.`
                        ),
                    });
                    return;
                }
                records.push({
                    id,
                    target: request.target as string,
                    slotKey: request.slotKey as string,
                    collectionKeysCount,
                    collectionKeys: (request.collectionKeys as string[]).slice(
                        0,
                        collectionKeysCount
                    ),
                });
            });
        } catch (error) {
            failures.push({ requestIds: idChunk, error: error as ProofRequestFailureCause });
        }
    }

    // Read every value. Bridge-owned requests batch through Multicall3 by
    // folding a `lockedTokens` read into the same call shape as above;
    // everything else falls back to a raw per-entry storage read.
    const values = new Array<string>(records.length);
    const bridgeIndices: number[] = [];
    const foreignIndices: number[] = [];
    records.forEach((record, index) => {
        if (record.target.toLowerCase() === bridgeAddress.toLowerCase()) {
            bridgeIndices.push(index);
        } else {
            foreignIndices.push(index);
        }
    });

    for (const indexChunk of chunk(bridgeIndices, RECORDS_PER_MULTICALL)) {
        try {
            const calls = indexChunk.map((index) => ({
                target: bridgeAddress,
                allowFailure: false,
                callData: bridge.interface.encodeFunctionData('lockedTokens', [
                    BigInt(records[index].collectionKeys[0]),
                ]),
            }));
            const aggregated: Multicall3Result[] = await withBackoff(() =>
                multicall.aggregate3.staticCall(calls, { blockTag: outputBlockNumber })
            );
            aggregated.forEach(({ returnData }, i) => {
                const [locked] = bridge.interface.decodeFunctionResult('lockedTokens', returnData);
                values[indexChunk[i]] = `0x${(locked as bigint).toString(16).padStart(64, '0')}`;
            });
        } catch (error) {
            failures.push({
                requestIds: indexChunk.map((index) => records[index].id),
                error: error as ProofRequestFailureCause,
            });
        }
    }

    const foreignValues = await mapWithConcurrency(
        foreignIndices,
        FALLBACK_CONCURRENCY,
        (index) =>
            provider.getStorage(records[index].target, records[index].slotKey, outputBlockNumber),
        (index, error) => {
            failures.push({
                requestIds: [records[index].id],
                error: error as ProofRequestFailureCause,
            });
        }
    );
    foreignIndices.forEach((index, i) => {
        const value = foreignValues[i];
        if (value !== undefined) values[index] = value;
    });

    if (failures.length > 0) {
        throw new ProofRequestBatchFetchError(failures);
    }

    return records.map((record, index) => ({
        target: record.target,
        collectionKeysCount: record.collectionKeysCount,
        collectionKeys: record.collectionKeys,
        value: values[index],
    }));
}
