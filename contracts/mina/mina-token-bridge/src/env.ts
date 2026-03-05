import { type NetworkId } from 'o1js';

type EnvName = 'development' | 'staging' | 'production';

type Env = {
    NORI_MINA_TOKEN_BRIDGE_ADDRESS: string;
    NORI_MINA_TOKEN_BASE_ADDRESS: string;
    NORI_MINA_TOKEN_BASE_TOKEN_ID: string;
    NORI_MINA_TOKEN_BRIDGE_TOKEN_ID: string;
    MINA_ARCHIVE_RPC_URL: string;
    MINA_RPC_NETWORK_URL: string;
    MINA_RPC_NETWORK_ID: NetworkId;
    MINA_ZKAPP_TRANSACTION_RPC_URL: string;
    NORI_WSS_URL: string;
    NORI_PCS_URL: string;
};

type NetworkName = 'mina' | 'zeko';

export const env: Partial<Record<NetworkName, Partial<Record<EnvName, Env>>>> =
    {
        mina: {
            staging: {
                NORI_MINA_TOKEN_BRIDGE_ADDRESS:
                    'B62qkzWqyEtSHyEaWGQ7AaJiRHqDD9T7ryyQz6fpamwf3z3SPvAiayh',
                NORI_MINA_TOKEN_BASE_ADDRESS:
                    'B62qj8MuZ4efsWBfWeyDaKXukVod8BTvDtKsYq6zSQ6X5dFEELiYjqo',
                NORI_MINA_TOKEN_BASE_TOKEN_ID:
                    '13548809602186658908121419225753857111133378200542457597649940477922233763750',
                NORI_MINA_TOKEN_BRIDGE_TOKEN_ID:
                    '23257910468495065247555306225437272846379428589965924744755704860109524722427',
                MINA_ARCHIVE_RPC_URL: 'https://archive-node.devnet.nori.it.com',
                MINA_RPC_NETWORK_URL:
                    'https://plain-1-graphql.mina-mesa-network.gcp.o1test.net/graphql',
                MINA_RPC_NETWORK_ID: 'devnet',
                MINA_ZKAPP_TRANSACTION_RPC_URL:
                    'https://mina-zkapp-transaction-api.devnet.nori.it.com/api/transactions',
                NORI_WSS_URL: 'wss://wss.nori.it.com',
                NORI_PCS_URL: 'https://pcs.nori.it.com',
            },
        },
    };
