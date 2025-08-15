import { JsonProof } from 'o1js';
import { NoriTokenControllerConfig } from '../../NoriControllerSubmitter.js';

/**
 * Specification of the methods exposed by E2eWorker
 * for parent proxying.
 */
export const workerSpec = {
    /**
     * Initialize the worker with NoriTokenController config.
     * @param config - NoriTokenControllerConfig
     */
    ready: async (config: NoriTokenControllerConfig) => {},

    /**
     * Setup storage for a user by their public key.
     * @param userPublicKeyBase58 - Base58-encoded public key
     * @returns Result of the storage setup
     */
    setupStorage: async (userPublicKeyBase58: string) => ({}),

    /**
     * Mint a token for a user.
     * @param userPublicKeyBase58 - Base58-encoded public key of the user
     * @param proofData - Contains deposit and presentation proofs
     * @param userPrivateKeyBase58 - Base58-encoded private key of the user
     * @param fundNewAccount - Optional boolean to fund the account
     * @returns Result of the mint operation
     */
    mint: async (
        userPublicKeyBase58: string,
        proofData: {
            ethDepositProofJson: JsonProof;
            presentationProofStr: string;
        },
        userPrivateKeyBase58: string,
        fundNewAccount?: boolean
    ) => ({}),
} as const;
