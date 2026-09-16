import {
    getEthereumProvider,
    type EthereumProvider,
} from '@nori-zk/ethers-iso-provider';
import { EthDataNotFoundError } from './errors.js';

/**
 * Estimated age (milliseconds) of a deposit, based on its block number.
 *
 * @param blockNumber The Ethereum block number that contains the deposit.
 * @param provider The Ethereum provider used to retrieve the block.
 * @returns The elapsed time between the block timestamp and the current clock,
 * expressed in milliseconds.
 */
export async function depositAge(
    blockNumber: bigint,
    provider: EthereumProvider = getEthereumProvider()
): Promise<number> {

    const block = await provider.getBlock(blockNumber);
    if (!block) {
        throw new EthDataNotFoundError(`Failed to fetch block #${blockNumber}.`);
    }

    const blockTimestampSeconds = block.timestamp;
    const nowSeconds = Math.floor(Date.now() / 1000);
    const secondsAgo = nowSeconds - blockTimestampSeconds;

    return secondsAgo * 1000;
}
