import { getInjectedEthProvider } from "./getInjectedProvider.js";

/**
 * Returns the latest block number.
 * @returns The block time
 */
export async function fetchLatestBlockHeight(): Promise<number> {
    const provider = getInjectedEthProvider();
    const block = await provider.getBlock('latest');
    if (!block) {
        throw new Error('Failed to fetch the latest block');
    }
    return block.number;
}