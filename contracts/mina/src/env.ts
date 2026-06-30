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
                    'B62qjigCVVzvy6LbRAMCqxhPqV8mGxwPxQJGPCMmpeqsfkYiyYBCLYq',
                NORI_MINA_TOKEN_BASE_ADDRESS:
                    'B62qqyZCu8kJWRZeiLp5QjFEgnxVQV2biKZAjz3fMX9gmcobd6kZn9R',
                NORI_ETH_TOKEN_BRIDGE_ADDRESS: '0xa2817F30a73B32860184E444Fc80018A45aD2CF6',
                NORI_ETH_GENESIS_ROOT: '0xd8ea171f3c94aea21ebc42a1ed61052acf3f9209c00e4efbaaddac09ed9b8078',
                NORI_MINA_TOKEN_BASE_TOKEN_ID:
                    '23207811039425078693436510285206559010493020387602225291050792895744129890740',
                NORI_MINA_TOKEN_BRIDGE_TOKEN_ID:
                    '6811376996622512476719015784840261938635317102403423887560127581629647405132',
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
