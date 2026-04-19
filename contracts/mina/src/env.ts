import { type NetworkId } from 'o1js';

type EnvName = 'development' | 'staging' | 'production';

type Env = {
    NORI_MINA_TOKEN_BRIDGE_ADDRESS: string;
    NORI_MINA_TOKEN_BASE_ADDRESS: string;
    NORI_ETH_TOKEN_BRIDGE_ADDRESS: string;
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
                    'B62qoiefY7SGviwBAdDddekjv65G1NqLvzwxtxXSjAo4kVx4UybysQP',
                NORI_MINA_TOKEN_BASE_ADDRESS:
                    'B62qryCm7G6Mk9tJ5o5crvfTs9QjUHiw6rww2mnQrUVDdzbwnDce1QG',
                NORI_ETH_TOKEN_BRIDGE_ADDRESS: '0x142B9d3fE3Caa2CE9DaA607A262Dc8561C694006',
                NORI_MINA_TOKEN_BASE_TOKEN_ID:
                    '1820725017453717818487944405494255499152401388438360132894647617164704161717',
                NORI_MINA_TOKEN_BRIDGE_TOKEN_ID:
                    '16993641201534759535596432025062741903783261489827245180429469885109562975771',
                MINA_ARCHIVE_RPC_URL: 'https://mesa-archive-node-api.gcp.o1test.net',
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
