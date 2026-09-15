import { type Provider } from 'ethers';
import { NoriProofRequestQueue__factory } from '@nori-zk/ethereum-token-bridge';
import { getInjectedEthProvider } from './getInjectedProvider.js';

export interface ProofRequest {
    requestId: bigint;
    target: string;
    slotKey: string;
    blockNumber: number;
    transactionHash: string;
}

/**
 * Fetches `ProofRequested` entries from the NoriProofRequestQueue in a block
 * range, filtered to one `target` (the NoriTokenBridge's Ethereum address
 * every bridge deposit enqueues under that target, since `requestProof`
 * stamps `target = msg.sender`).
 */
/*export async function fetchProofRequest(
    proofQueueAddress: string,
    targetAddress: string,
    fromBlock: number,
    toBlock: number | 'latest',
    provider: Provider = getInjectedEthProvider()
): Promise<ProofRequest[]> {
    const queue = NoriProofRequestQueue__factory.connect(proofQueueAddress, provider);
    const events = await queue.queryFilter(
        queue.filters.ProofRequested(undefined, targetAddress),
        fromBlock,
        toBlock
    );
    return events.map((event) => ({
        requestId: event.args.requestId,
        target: event.args.target,
        slotKey: event.args.slotKey,
        blockNumber: event.blockNumber,
        transactionHash: event.transactionHash,
    }));
}*/ // REDUNDANT


/**
 * Finds our own request's requestId directly from the
 * deposit's transaction hash the `ProofRequested` log is emitted in the
 * same transaction as the deposit, so this needs no range scan or matching
 * heuristic when the tx hash is already known.
 */
export async function findRequestIdByTxHash(
    proofQueueAddress: string,
    depositTxHash: string,
    provider: Provider = getInjectedEthProvider()
): Promise<ProofRequest> {
    const queue = NoriProofRequestQueue__factory.connect(proofQueueAddress, provider);
    const receipt = await provider.getTransactionReceipt(depositTxHash);
    if (!receipt) {
        throw new Error(`No transaction receipt found for ${depositTxHash}.`);
    }
    for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== proofQueueAddress.toLowerCase()) continue;
        const parsed = queue.interface.parseLog(log);
        if (!parsed || parsed.name !== 'ProofRequested') continue;
        return {
            requestId: parsed.args.requestId as bigint,
            target: parsed.args.target as string,
            slotKey: parsed.args.slotKey as string,
            blockNumber: log.blockNumber,
            transactionHash: log.transactionHash,
        };
    }
    throw new Error(
        `No ProofRequested log found for queue ${proofQueueAddress} in tx ${depositTxHash}.`
    );
}
