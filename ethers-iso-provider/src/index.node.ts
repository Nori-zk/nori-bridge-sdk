import process from 'node:process';
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

function getInjectedProvider(): Eip1193Provider | undefined {
    return (globalThis as { ethereum?: Eip1193Provider }).ethereum;
}

export function getEthereumProvider(): EthereumProvider {
    ethereumProvider ??= createEthereumProvider({
        rpcUrl: process.env.ETH_RPC_URL,
        injectedProvider: getInjectedProvider(),
    });

    return ethereumProvider;
}
