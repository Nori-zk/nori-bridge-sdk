import { NetworkId } from 'o1js';

type EnvName = 'development' | 'staging' | 'production';

type Env = {
    NORI_TOKEN_BRIDGE_ADDRESS: string;
    NORI_TOKEN_CONTROLLER_ADDRESS: string;
    TOKEN_BASE_ADDRESS: string;
    MINA_RPC_NETWORK_URL: string;
    MINA_RPC_NETWORK_ID: NetworkId;
};

export const env: Partial<Record<EnvName, Env>> = {
    staging: {
        NORI_TOKEN_BRIDGE_ADDRESS: '0x3EEACD9caa1aDdBA939FF041C43020b516A51dcF',
        NORI_TOKEN_CONTROLLER_ADDRESS:
            'B62qqRRNz7pGh29GmTYmJrk5RFieZnCTv5cUE4zBse8tNdR5NayUL7G',
        TOKEN_BASE_ADDRESS:
            'B62qphX4CxksMDHKuJLXyBLc5MdMNjQGSRNg8kU2Z3J7QQ5dpDcLxDk',
        MINA_RPC_NETWORK_URL: 'https://api.minascan.io/node/devnet/v1/graphql',
        MINA_RPC_NETWORK_ID: 'devnet',
    },
};