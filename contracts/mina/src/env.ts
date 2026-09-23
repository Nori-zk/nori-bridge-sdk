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
                    'B62qizrJ4qfYbG17RmotjiUqpHytH1Z7DdrcGLoj6RSGxVjaJQrFnWK',
                NORI_MINA_TOKEN_BASE_ADDRESS:
                    'B62qpZfxhosJ1wZQNnLDZ2BpNUvdFuxZg4muTUkhgq9gAnTRVagTpmW',
                NORI_ETH_TOKEN_BRIDGE_ADDRESS: '0xE2e295F75e268B1feDb2C43291C33a932adaf2b8',
                // Placeholder until the NoriProofRequestQueue is deployed; written by ethereum `npm run deploy`.
                NORI_ETH_PROOF_QUEUE_ADDRESS: '0x528A504FA206e775646149038dfF80DE58089031',
                NORI_MINA_TOKEN_BASE_TOKEN_ID:
                    '213061865830418241245201927967830558224901847789464716973027458036009560597',
                NORI_MINA_TOKEN_BRIDGE_TOKEN_ID:
                    '14684789014999748479725234456661936089652887713185506839687779272403773390411',
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
