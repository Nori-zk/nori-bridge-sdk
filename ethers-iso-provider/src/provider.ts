import {
    BrowserProvider,
    JsonRpcProvider,
    type Eip1193Provider,
    type Provider,
} from 'ethers';

export type EthereumProvider = Provider;

export type CreateEthereumProviderOptions = {
    provider?: EthereumProvider;
    rpcUrl?: string;
    injectedProvider?: Eip1193Provider;
};

function parseRpcUrl(rpcUrl: string): string {
    let url: URL;

    try {
        url = new URL(rpcUrl);
    } catch {
        throw new Error('ETH_RPC_URL must be an absolute HTTP(S) URL.');
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('ETH_RPC_URL must use HTTP or HTTPS.');
    }

    return url.toString();
}

export function createEthereumProvider({
    provider,
    rpcUrl,
    injectedProvider,
}: CreateEthereumProviderOptions = {}): EthereumProvider {
    if (provider) return provider;

    if (rpcUrl !== undefined) {
        return new JsonRpcProvider(parseRpcUrl(rpcUrl));
    }

    if (injectedProvider) {
        return new BrowserProvider(injectedProvider);
    }

    throw new Error(
        'No Ethereum provider configured. Set ETH_RPC_URL or provide an EIP-1193 provider.'
    );
}
