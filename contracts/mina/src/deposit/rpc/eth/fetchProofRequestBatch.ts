import { Contract } from 'ethers';
import { NoriProofRequestQueue__factory } from '@nori-zk/ethereum-token-bridge';
import {
    getEthereumProvider,
    type EthereumProvider,
} from '@nori-zk/ethers-iso-provider';
import {
    EthCallFailedError,
    EthRpcTransportError,
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
 * Concurrency for reading each request's value. A request's `target` can be
 * any contract, and there's no way to read another contract's storage from
 * within a contract call, so this can't be folded into Multicall3 and goes
 * through the provider's own transport one call at a time. Kept low since
 * this is expected to run against a wallet's default provider, not a
 * dedicated endpoint.
 */
const VALUE_READ_CONCURRENCY = 8;

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
 * one's `slotKey` points at on its own `target`, at `outputBlockNumber`. Makes
 * no assumption about who `target` is or what its storage layout means; the
 * queue itself treats `slotKey` as opaque, and so does this function.
 *
 * @param proofQueueAddress The `NoriProofRequestQueue` address.
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
    inputQueueCursor: bigint,
    outputQueueCursor: bigint,
    outputBlockNumber: number,
    provider: EthereumProvider = getEthereumProvider()
): Promise<ProofRequestBatchEntry[]> {
    const count = outputQueueCursor - inputQueueCursor;
    if (count <= 0n) return [];

    const queue = NoriProofRequestQueue__factory.connect(proofQueueAddress, provider);
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

    // Read every value directly off its own target's storage. No target's
    // ABI is assumed, so this can't be folded into the queue's Multicall3
    // batch above.
    const values = await mapWithConcurrency(
        records,
        VALUE_READ_CONCURRENCY,
        (record) => provider.getStorage(record.target, record.slotKey, outputBlockNumber),
        (record, error) => {
            failures.push({ requestIds: [record.id], error: error as ProofRequestFailureCause });
        }
    );

    if (failures.length > 0) {
        throw new ProofRequestBatchFetchError(failures);
    }

    return records.map((record, index) => ({
        target: record.target,
        collectionKeysCount: record.collectionKeysCount,
        collectionKeys: record.collectionKeys,
        value: values[index] as string,
    }));
}
