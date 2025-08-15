type CharArray<S extends string> = S extends `${infer First}${infer Rest}`
    ? [First, ...CharArray<Rest>]
    : [];

type CountChars<S extends string> = CharArray<S>['length'];

type ArrayOfLength<
    Length extends number,
    Collected extends unknown[] = []
> = Collected['length'] extends Length
    ? Collected
    : ArrayOfLength<Length, [unknown, ...Collected]>;

type IsAtMost<
    S extends string,
    Max extends number
> = ArrayOfLength<Max> extends [...ArrayOfLength<CountChars<S>>, ...unknown[]]
    ? true
    : false;

type LengthMismatchError<Expected extends number> = {
    expectedLength: Expected;
};

// String length enforcement types.

// Fixed length string enforcement type.
type EnforceLength<S extends string, N extends number> = CountChars<S> extends N
    ? S
    : LengthMismatchError<N>;

// Max length string enforcement type.
export type EnforceMaxLength<S extends string, Max extends number> = IsAtMost<
    S,
    Max
> extends true
    ? S
    : LengthMismatchError<Max>;

const secretMaxLength = 20 as const;
export type SecretMaxLength = typeof secretMaxLength;

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
    computeCredential: async <FixedString extends string>(
        secret: EnforceMaxLength<FixedString, SecretMaxLength>,
        ethSecretSignature: string,
        ethWalletAddress: string,
        minaPublicKeyBase58: string
    ): Promise<string> => {
        return '';
    },

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
