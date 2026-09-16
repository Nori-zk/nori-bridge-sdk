import { Contract } from 'ethers';
import { NoriProofRequestQueue__factory } from '@nori-zk/ethereum-token-bridge';
import type { EthereumProvider } from '@nori-zk/ethers-iso-provider';
import { withBackoff, type ProofRequestRecord } from './fetchProofRequestBatch.js';

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

/** Max entries per `aggregate3` call, kept under typical `eth_call` gas caps. */
const RECORDS_PER_MULTICALL = 200;

function chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
}

/**
 * Reads every `NoriProofRequestQueue` record with id in
 * `[inputQueueCursor, outputQueueCursor)` by calling `requests(id)` at
 * `blockNumber`, batched through Multicall3. Used only for the queue's
 * first-ever batch, which has no previous settlement job to give a log
 * search a lower bound.
 *
 * @param proofQueueAddress The `NoriProofRequestQueue` address.
 * @param inputQueueCursor Inclusive lower bound of the batch (queue request id).
 * @param outputQueueCursor Exclusive upper bound of the batch.
 * @param blockNumber The Ethereum block to read every record at.
 * @param provider The Ethereum provider used for every read.
 * @returns One record per request in the batch, in queue order.
 */
export default async function fetchProofRequestBatchByCall(
    proofQueueAddress: string,
    inputQueueCursor: bigint,
    outputQueueCursor: bigint,
    blockNumber: number,
    provider: EthereumProvider
): Promise<ProofRequestRecord[]> {
    const queue = NoriProofRequestQueue__factory.connect(proofQueueAddress, provider);
    const multicall = new Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, provider);
    const ids = Array.from(
        { length: Number(outputQueueCursor - inputQueueCursor) },
        (_unused, k) => inputQueueCursor + BigInt(k)
    );

    const records: ProofRequestRecord[] = [];
    for (const idChunk of chunk(ids, RECORDS_PER_MULTICALL)) {
        const calls = idChunk.map((id) => ({
            target: proofQueueAddress,
            allowFailure: false,
            callData: queue.interface.encodeFunctionData('requests', [id]),
        }));
        const aggregated: Multicall3Result[] = await withBackoff(() =>
            multicall.aggregate3.staticCall(calls, { blockTag: blockNumber })
        );
        aggregated.forEach(({ returnData }, i) => {
            const [request] = queue.interface.decodeFunctionResult('requests', returnData);
            const collectionKeysCount = Number(request.collectionKeysCount);
            records.push({
                id: idChunk[i],
                target: request.target as string,
                slotKey: request.slotKey as string,
                collectionKeysCount,
                collectionKeys: (request.collectionKeys as string[]).slice(0, collectionKeysCount),
            });
        });
    }
    return records;
}
