import { BrowserProvider, type Eip1193Provider } from 'ethers';

/**
 * Wraps the wallet's injected EIP-1193 provider (MetaMask, and anything else
 * that injects `window.ethereum`) as an ethers provider, rather than
 * maintaining a separate RPC endpoint/API key for read-only ETH queries.
 */
export function getInjectedEthProvider(): BrowserProvider {
    const injected = (globalThis as { ethereum?: Eip1193Provider }).ethereum;
    if (!injected) {
        throw new Error(
            'No injected Ethereum provider found (e.g. MetaMask). Connect a wallet first.'
        );
    }
    return new BrowserProvider(injected);
}
