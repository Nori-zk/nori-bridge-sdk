import { type NetworkId } from 'o1js';

type EnvName = 'development' | 'staging' | 'production';

type Env = {
    NORI_MINA_TOKEN_BRIDGE_ADDRESS: string;
    NORI_MINA_TOKEN_BASE_ADDRESS: string;
    NORI_ETH_TOKEN_BRIDGE_ADDRESS: string;
    NORI_ETH_PROOF_QUEUE_ADDRESS: string;
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
                    'B62qmMvzQNSCnZ4qH1N9uJByov9EyGushzv1jV7Cqg8UwS6BrRgHGzk',
                NORI_MINA_TOKEN_BASE_ADDRESS:
                    'B62qjF2S71pPfMyiSBXscHVmsHtBReRzXB1DkMg6HxZUbPW2a1bYSQH',
                NORI_ETH_TOKEN_BRIDGE_ADDRESS: '0xa2817F30a73B32860184E444Fc80018A45aD2CF6',
                // Placeholder until the NoriProofRequestQueue is deployed; written by ethereum `npm run deploy`.
                NORI_ETH_PROOF_QUEUE_ADDRESS: '0x0000000000000000000000000000000000000000',
                NORI_MINA_TOKEN_BASE_TOKEN_ID:
                    '24076995954020199447973315155258633096183592652675591033300568109713209038362',
                NORI_MINA_TOKEN_BRIDGE_TOKEN_ID:
                    '13777098415199831791531080343181889531730769260227911933839499395711118342003',
                MINA_ARCHIVE_RPC_URL: 'https://archive-node-api.mesa-rc.minaprotocol.com',
                MINA_RPC_NETWORK_URL:
                    'https://plain-1-graphql.mesa-rc.minaprotocol.com/graphql',
                MINA_RPC_NETWORK_ID: 'devnet',
                MINA_ZKAPP_TRANSACTION_RPC_URL:
                    'https://mina-zkapp-transaction-api.devnet.nori.it.com/api/transactions', // FIXME this is still not mesa!
                NORI_WSS_URL: 'wss://wss.nori.it.com',
                NORI_PCS_URL: 'https://pcs.nori.it.com',
            },
        },
    };
