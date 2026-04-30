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
                    'B62qncFKapzR9RWDubdmrfdGxuYKCE5JMFtm1mtYW6Uo5rtiA1MWGwA',
                NORI_MINA_TOKEN_BASE_ADDRESS:
                    'B62qkZoWX6PcYTZKBYtqPDApySthckmt1T76dQx1urvm6J5NnZgT1DF',
                NORI_ETH_TOKEN_BRIDGE_ADDRESS: '0x849b8bd52B55579682264B3CB5E10839E478E543',
                NORI_MINA_TOKEN_BASE_TOKEN_ID:
                    '17112140320541690424326608687027005637835476048388614802877003599438271790515',
                NORI_MINA_TOKEN_BRIDGE_TOKEN_ID:
                    '11059162023103561649889259751378601715986118246125012520240418710266101727765',
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
