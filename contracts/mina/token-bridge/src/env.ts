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
        NORI_TOKEN_BRIDGE_ADDRESS: '0x716e124a864a466814C29e55A898f7F005B0Cd46',
        NORI_TOKEN_CONTROLLER_ADDRESS:
            'B62qjymLWRpQhwWa91ET5b9FqrLmB6CtBQ1ZbHcj8wSbAGcLRmUExzt',
        TOKEN_BASE_ADDRESS:
            'B62qp1YBCbuvBsXFVLGMU5ASmv1r4BbTRW4epHuEz3CHbLL8wfjje4F',
        MINA_RPC_NETWORK_URL: 'https://api.minascan.io/node/devnet/v1/graphql',
        MINA_RPC_NETWORK_ID: 'devnet',
    },
};