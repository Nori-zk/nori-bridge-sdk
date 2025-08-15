/**
 * Specification of the methods exposed by CredentialAttestationWorker
 * for parent proxying.
 */
export const workerSpec = {
    /** Compile the necessary ECDSA Mina / Ethereum programs */
    compile: async () => {},

    /**
     * Generate a presentation request JSON for a given Mina zkApp public key.
     * @param zkAppPublicKeyBase58 - Base58-encoded Mina zkApp public key
     * @returns Presentation request JSON
     */
    computeEcdsaSigPresentationRequest: async (zkAppPublicKeyBase58: string) =>
        '',

    /**
     * Generate a credential for a user.
     * @param secret - Secret string, enforced max length
     * @param ethSecretSignature - Ethereum signature of the secret
     * @param ethWalletAddress - Ethereum wallet address
     * @param minaPublicKeyBase58 - Base58-encoded Mina public key
     * @returns Credential JSON
     */
    computeCredential: async (
        secret: string,
        ethSecretSignature: string,
        ethWalletAddress: string,
        minaPublicKeyBase58: string
    ) => '',

    /**
     * Compute a presentation for the wallet using the given credential
     * and presentation request.
     * @param presentationRequestJson - JSON of the presentation request
     * @param credentialJson - JSON of the credential
     * @param minaPrivateKeyBase58 - Base58-encoded Mina private key
     * @returns Presentation JSON
     */
    WALLET_computeEcdsaSigPresentation: async (
        presentationRequestJson: string,
        credentialJson: string,
        minaPrivateKeyBase58: string
    ) => '',

    /**
     * Deploy and verify the EcdsaSigPresentationVerifier zkApp
     * using the provided presentation JSON. Only for testing / dev.
     * @param zkAppPrivateKeyBase58 - Base58 zkApp private key
     * @param senderPrivateKeyBase58 - Base58 sender private key
     * @param presentationJSON - Presentation JSON to verify
     */
    MOCK_deployAndVerifyEcdsaSigPresentationVerifier: async (
        zkAppPrivateKeyBase58: string,
        senderPrivateKeyBase58: string,
        presentationJSON: string
    ) => {},
} as const;
