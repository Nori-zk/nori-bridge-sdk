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
                    'B62qk5YCkfLCkjPuFQGgyQF4R8JqdHZTC1dnGD87b5sGABDenmm98GM',
                NORI_MINA_TOKEN_BASE_ADDRESS:
                    'B62qqrGGc3hx6PxUaoyb5bcGuYUxWVkkEdXmAVzaQULdZ5V3mcmhsSZ',
                NORI_MINA_TOKEN_BASE_TOKEN_ID:
                    '25752212657326802597915367750324599302227063476680490393442702566980675831190',
                NORI_MINA_TOKEN_BRIDGE_TOKEN_ID:
                    '18872171003784898968646463492176862693853643552219525039200848768175143970235',
                MINA_ARCHIVE_RPC_URL: 'https://archive-node.devnet.nori.it.com',
                MINA_RPC_NETWORK_URL:
                    'https://plain-1-graphql.mina-mesa-network.gcp.o1test.net/graphql',
                MINA_RPC_NETWORK_ID: 'devnet',
                MINA_ZKAPP_TRANSACTION_RPC_URL:
                    'https://mina-zkapp-transaction-api.devnet.nori.it.com/api/transactions', // FIXME this is still not mesa!
                NORI_WSS_URL: 'wss://wss.mesa.nori.it.com',
                NORI_PCS_URL: 'https://pcs.mesa.nori.it.com',
            },
        },
    };
