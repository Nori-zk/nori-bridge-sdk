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
                    'B62qrqvQUkTFhtsXNZBqeCzHeUBWshyfAcYW1PQMjHQHnAFEF2v6iMw',
                NORI_MINA_TOKEN_BASE_ADDRESS:
                    'B62qjwmX8pjTd1aiCUP1vcpcy2LXLQcYExTkxwJTc4xkAE9yPvjoCDC',
                NORI_ETH_TOKEN_BRIDGE_ADDRESS: '0x142B9d3fE3Caa2CE9DaA607A262Dc8561C694006',
                NORI_MINA_TOKEN_BASE_TOKEN_ID:
                    '22499030354249609939568630776323408829447863349803831756153997917176100631268',
                NORI_MINA_TOKEN_BRIDGE_TOKEN_ID:
                    '5138110091031088034016539115845999125185999348838996106471643399483137603633',
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
