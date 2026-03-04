import { type NetworkId } from 'o1js';

type EnvName = 'development' | 'staging' | 'production';

type Env = {
    NORI_TOKEN_BRIDGE_ADDRESS: string;
    NORI_TOKEN_CONTROLLER_ADDRESS: string;
    TOKEN_BASE_ADDRESS: string;
    TOKEN_BASE_TOKEN_ID: string;
    NORI_TOKEN_CONTROLLER_TOKEN_ID: string;
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
                NORI_TOKEN_BRIDGE_ADDRESS:
                    '0xc69dc348594168cAfD003F7D2340264DBcBEA40b',
                NORI_TOKEN_CONTROLLER_ADDRESS:
                    'B62qjG4nddBC6SMDNXXiLwDgf49SSKHG51cnsD4Xh4zgGh8h99DsaQB',
                TOKEN_BASE_ADDRESS:
                    'B62qqDnDEEAkFatsN3WdbuJ9mxb7y5VywFzKCA7Yj93SkkoQU1pfpio',
                TOKEN_BASE_TOKEN_ID:
                    '11721631656846901930765495286036281890935381019970777414550300219117311353736',
                NORI_TOKEN_CONTROLLER_TOKEN_ID:
                    '14538635346799249748896588374890265616689045468986440153413394516122841324583',
                MINA_ARCHIVE_RPC_URL: 'https://archive-node.devnet.nori.it.com',
                MINA_RPC_NETWORK_URL:
                    'https://mina-node.devnet.nori.it.com/graphql',
                MINA_RPC_NETWORK_ID: 'devnet',
                MINA_ZKAPP_TRANSACTION_RPC_URL:
                    'https://mina-zkapp-transaction-api.devnet.nori.it.com/api/transactions',
                NORI_WSS_URL: 'wss://wss.nori.it.com',
                NORI_PCS_URL: 'https://pcs.nori.it.com',
            },
        },
    };
