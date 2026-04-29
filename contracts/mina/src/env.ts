import { type NetworkId } from 'o1js';

type EnvName = 'development' | 'staging' | 'production';

type Env = {
    NORI_MINA_TOKEN_BRIDGE_ADDRESS: string;
    NORI_MINA_TOKEN_BASE_ADDRESS: string;
    NORI_ETH_TOKEN_BRIDGE_ADDRESS: string;
    NORI_ETH_GENESIS_ROOT: string;
    NORI_MINA_TOKEN_BASE_TOKEN_ID: string;
    NORI_MINA_TOKEN_BRIDGE_TOKEN_ID: string;
    MINA_ARCHIVE_RPC_URL: string;
    MINA_RPC_NETWORK_URL: string;
    MINA_RPC_NETWORK_ID: NetworkId;
    MINA_ZKAPP_TRANSACTION_RPC_URL: string;
    NORI_WSS_URL: string;
    NORI_PCS_URL: string;
};

export type NetworkName = 'mina' | 'zeko';

export const env: Partial<Record<NetworkName, Partial<Record<EnvName, Env>>>> =
    {
        mina: {
            staging: {
                NORI_MINA_TOKEN_BRIDGE_ADDRESS:
                    'B62qnACDhucgLab215x7JDJxieSPSKVqoTABfRizLbiJevbAxf6452B',
                NORI_MINA_TOKEN_BASE_ADDRESS:
                    'B62qntxfsJN32rqtxCHegQuwmhnBweYSm5V759vqfwTRjkEkjXbWu29',
                NORI_ETH_TOKEN_BRIDGE_ADDRESS: '0xb3b05Cf23Bd11d66724D1d0e90c26aa152a49f05',
                NORI_ETH_GENESIS_ROOT: '0xd8ea171f3c94aea21ebc42a1ed61052acf3f9209c00e4efbaaddac09ed9b8078',
                NORI_MINA_TOKEN_BASE_TOKEN_ID:
                    '24098714746905983835104154056693549708624840478268637089705991354502404436988',
                NORI_MINA_TOKEN_BRIDGE_TOKEN_ID:
                    '12400710434375992068583964199024771138334414971199242896756582360882388023323',
                MINA_ARCHIVE_RPC_URL: 'https://mesa-archive-node-api.gcp.o1test.net',
                MINA_RPC_NETWORK_URL:
                    'https://plain-1-graphql.mina-mesa-network.gcp.o1test.net/graphql',
                MINA_RPC_NETWORK_ID: 'devnet',
                MINA_ZKAPP_TRANSACTION_RPC_URL:
                    'https://mina-zkapp-transaction-api.devnet.nori.it.com/api/transactions', // FIXME this is still not mesa!
                NORI_WSS_URL: 'wss://wss.nori.it.com',
                NORI_PCS_URL: 'https://pcs.nori.it.com',
            },
        },
    };
