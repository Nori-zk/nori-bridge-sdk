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
                    'B62qr5LdS7WsssysJvHtFWa7by7cGMyKpa1zFJTM6HBw6U8Hbk9PSRo',
                NORI_MINA_TOKEN_BASE_ADDRESS:
                    'B62qpP2tbHnVTojT6P174W2WgwH4C88StwVwEnEYGRFDuUUqWLmcn9F',
                NORI_ETH_TOKEN_BRIDGE_ADDRESS: '0x849b8bd52B55579682264B3CB5E10839E478E543',
                NORI_ETH_GENESIS_ROOT: '0xd8ea171f3c94aea21ebc42a1ed61052acf3f9209c00e4efbaaddac09ed9b8078',
                NORI_MINA_TOKEN_BASE_TOKEN_ID:
                    '20012006927486142574234329572513631455538138932987466281417210990567717835743',
                NORI_MINA_TOKEN_BRIDGE_TOKEN_ID:
                    '26360635381127591402214545895164766476862904419458504204838777026317571337609',
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
