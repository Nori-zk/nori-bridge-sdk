import type { Eip1193Provider } from 'ethers';
import {
    createEthereumProvider,
    type EthereumProvider,
} from './provider.js';

export {
    createEthereumProvider,
    type CreateEthereumProviderOptions,
    type EthereumProvider,
} from './provider.js';

let ethereumProvider: EthereumProvider | undefined;

function getRpcUrl(): string | undefined {
    return (
        globalThis as {
            process?: { env?: { ETH_RPC_URL?: string } };
        }
    ).process?.env?.ETH_RPC_URL;
}

function getInjectedProvider(): Eip1193Provider | undefined {
    return (globalThis as { ethereum?: Eip1193Provider }).ethereum;
}

export function getEthereumProvider(): EthereumProvider {
    ethereumProvider ??= createEthereumProvider({
        rpcUrl: getRpcUrl(),
        injectedProvider: getInjectedProvider(),
    });

    return ethereumProvider;
}
