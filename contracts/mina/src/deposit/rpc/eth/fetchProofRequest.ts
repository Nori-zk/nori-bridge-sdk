import { NoriProofRequestQueue__factory } from '@nori-zk/ethereum-token-bridge';
import {
    getEthereumProvider,
    type EthereumProvider,
} from '@nori-zk/ethers-iso-provider';
import { EthDataNotFoundError } from './errors.js';

export interface ProofRequest {
    requestId: bigint;
    target: string;
    slotKey: string;
    blockNumber: number;
    transactionHash: string;
}

/**
 * Finds the proof request emitted by a deposit transaction. The
 * `ProofRequested` log is emitted in the deposit transaction, so no range
 * scan or matching heuristic is required when its hash is known.
 *
 * @param proofQueueAddress The address of the Nori proof request queue.
 * @param depositTxHash The hash of the Ethereum deposit transaction.
 * @param provider The Ethereum provider used to retrieve the transaction receipt.
 * @returns The proof request decoded from the matching `ProofRequested` log.
 * @throws When the transaction receipt is unavailable or contains no matching log.
 */
export async function findRequestIdByTxHash(
    proofQueueAddress: string,
    depositTxHash: string,
    provider: EthereumProvider = getEthereumProvider()
): Promise<ProofRequest> {
    const queue = NoriProofRequestQueue__factory.connect(proofQueueAddress, provider);
    const receipt = await provider.getTransactionReceipt(depositTxHash);
    if (!receipt) {
        throw new EthDataNotFoundError(`No transaction receipt found for ${depositTxHash}.`);
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
    throw new EthDataNotFoundError(
        `No ProofRequested log found for queue ${proofQueueAddress} in tx ${depositTxHash}.`
    );
}
