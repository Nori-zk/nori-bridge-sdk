import {
    getEthereumProvider,
    type EthereumProvider,
} from '@nori-zk/ethers-iso-provider';
import { EthDataNotFoundError } from './errors.js';

/**
 * Retrieves the number of the latest Ethereum block.
 *
 * @param provider The Ethereum provider used to retrieve the latest block.
 * @returns The latest Ethereum block number.
 */
export async function fetchLatestBlockHeight(
    provider: EthereumProvider = getEthereumProvider()
): Promise<number> {
    const block = await provider.getBlock('latest');
    if (!block) {
        throw new EthDataNotFoundError('Failed to fetch the latest block');
    }
    return block.number;
}
