import { getInjectedEthProvider } from './getInjectedProvider.js';

/**
 * Estimates the age (in milliseconds) of a deposit based on its block number.
 *
 * @param blockNumber - The block number in which the deposit was committed.
 * @returns The elapsed time since this block as created in milliseconds.
 */
export async function depositAge(blockNumber: bigint): Promise<number> {
    const provider = getInjectedEthProvider();

    const block = await provider.getBlock(blockNumber);
    if (!block) {
        throw new Error(`Failed to fetch block #${blockNumber}.`);
    }

    const blockTimestampSeconds = block.timestamp;
    const nowSeconds = Math.floor(Date.now() / 1000);
    const secondsAgo = nowSeconds - blockTimestampSeconds;

    return secondsAgo * 1000;
}