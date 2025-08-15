import { JsonProof, NetworkId } from 'o1js';

export interface MintProofDataJson {
    ethDepositProofJson: JsonProof,
    presentationProofStr: string
}

/**
 * Specification of the methods exposed by TokenMintWorker
 * for parent proxying.
 */
export const workerSpec = {
    /**
     * (Wallet) Set the Mina private key for signing wallet actions.
     * @param minaPrivateKeyBase58 - Base58-encoded Mina private key
     */
    WALLET_setMinaPrivateKey: async (minaPrivateKeyBase58: string) => ({}),

    /**
     * (Wallet) Create an ECDSA signature presentation using a credential and a presentation request.
     * @param presentationRequestJson - Presentation request JSON
     * @param credentialJson - Credential JSON
     * @returns Presentation JSON string
     */
    WALLET_computeEcdsaSigPresentation: async (
        presentationRequestJson: string,
        credentialJson: string
    ) => '',

    /**
     * (Wallet) Sign and send a proved transaction JSON.
     * @param provedTxJsonStr - Proved transaction JSON (string)
     * @returns Object containing txHash
     */
    WALLET_signAndSend: async (provedTxJsonStr: string) => ({ txHash: '' }),

    /**
     * Compile credential-related dependencies (ECDSA / presentation verifier).
     */
    compileCredentialDeps: async () => ({}),

    /**
     * Compute a credential from secret and Ethereum signature/address.
     * @param secret - Secret string (enforced max length)
     * @param ethSecretSignature - Ethereum signature of the secret
     * @param ethWalletAddress - Ethereum wallet address
     * @param senderPublicKeyBase58 - Mina public key (Base58) of the sender
     * @returns Credential JSON string
     */
    computeCredential: async (
        secret: string,
        ethSecretSignature: string,
        ethWalletAddress: string,
        senderPublicKeyBase58: string
    ) => '',

    /**
     * Create an ECDSA presentation request for a given zkApp public key.
     * @param zkAppPublicKeyBase58 - Base58-encoded zkApp public key
     * @returns Presentation request JSON string
     */
    computeEcdsaSigPresentationRequest: async (zkAppPublicKeyBase58: string) =>
        '',

    /**
     * Compile Eth deposit program dependencies (ContractDepositAttestor, EthVerifier, EthDepositProgram).
     */
    compileEthDepositProgramDeps: async () => ({}),

    /**
     * Compute an Eth deposit (E2E) from presentation and deposit details.
     * @param presentationJson - Presentation JSON string
     * @param depositBlockNumber - Deposit block number
     * @param ethAddressLowerHex - Ethereum address (lowercase hex)
     * @returns Object with despositSlotRaw and ethDepositProofJson
     */
    computeEthDeposit: async (
        presentationJson: string,
        depositBlockNumber: number,
        ethAddressLowerHex: string
    ): Promise<{
        depositSlotRaw: {
            slot_key_address: string;
            slot_nested_key_attestation_hash: string;
            value: string;
        };
        ethDepositProofJson: JsonProof;
    }> => ({
        depositSlotRaw: {
            slot_key_address: '',
            slot_nested_key_attestation_hash: '',
            value: '',
        },
        ethDepositProofJson: {} as JsonProof,
    }),

    /**
     * Setup Mina network instance.
     * @param options - Mina network options
     */
    minaSetup: async (options: {
        networkId?: NetworkId;
        mina: string | string[];
        archive?: string | string[];
        lightnetAccountManager?: string;
        bypassTransactionLimits?: boolean;
        minaDefaultHeaders?: HeadersInit;
        archiveDefaultHeaders?: HeadersInit;
    }) => {},

    /**
     * Get token balance of an account for a given token base.
     * @param noriTokenBaseBase58 - Base58 address of the token base
     * @param minaSenderPublicKeyBase58 - Base58 public key of the account
     * @returns Balance as a big-int string
     */
    getBalanceOf: async (
        noriTokenBaseBase58: string,
        minaSenderPublicKeyBase58: string
    ) => '',

    /**
     * Return the amount minted so far for a controller / user.
     * @param noriTokenControllerAddressBase58 - Controller address (Base58)
     * @param minaSenderPublicKeyBase58 - Sender public key (Base58)
     * @returns Minted amount as big-int string
     */
    mintedSoFar: async (
        noriTokenControllerAddressBase58: string,
        minaSenderPublicKeyBase58: string
    ) => '',

    /**
     * Check whether storage setup is required for a user.
     * @param noriTokenControllerAddressBase58 - Controller address (Base58)
     * @param minaSenderPublicKeyBase58 - Sender public key (Base58)
     * @returns boolean indicating whether setup is needed
     */
    needsToSetupStorage: async (
        noriTokenControllerAddressBase58: string,
        minaSenderPublicKeyBase58: string
    ) => false,

    /**
     * Prepare storage setup transaction for a user (returns proved tx JSON).
     * @param userPublicKeyBase58 - User public key (Base58)
     * @param noriAddressBase58 - Nori controller address (Base58)
     * @param txFee - Fee to use for setup transaction
     * @param storageInterfaceVerificationKeySafe - { data, hashStr } for storage interface
     * @returns Proved transaction JSON (string)
     */
    setupStorage: async (
        userPublicKeyBase58: string,
        noriAddressBase58: string,
        txFee: number,
        storageInterfaceVerificationKeySafe: { data: string; hashStr: string }
    ) => '',

    /**
     * Mock helper that performs storage setup and signs/sends using worker's mina key.
     * @param userPublicKeyBase58 - User public key (Base58)
     * @param noriAddressBase58 - Nori controller address (Base58)
     * @param txFee - Fee to use for setup transaction
     * @param storageInterfaceVerificationKeySafe - { data, hashStr } for storage interface
     * @returns Object containing txHash
     */
    MOCK_setupStorage: async (
        userPublicKeyBase58: string,
        noriAddressBase58: string,
        txFee: number,
        storageInterfaceVerificationKeySafe: { data: string; hashStr: string }
    ) => ({ txHash: '' }),

    /**
     * Compile minter-related dependencies (NoriStorageInterface, FungibleToken, NoriTokenController).
     * @returns verification key data and hash string
     */
    compileMinterDeps: async () =>
        ({ data: '', hashStr: '' } as {
            data: string;
            hashStr: string;
        }),

    /**
     * Mint tokens: create a mint transaction and return proved tx JSON.
     * @param userPublicKeyBase58 - User public key (Base58)
     * @param noriAddressBase58 - Nori controller address (Base58)
     * @param proofDataJson - Mint proof data JSON (MintProofDataJson)
     * @param txFee - Fee to use for mint transaction
     * @param fundNewAccount - whether to fund new account
     * @returns Proved transaction JSON (string)
     */
    mint: async (
        userPublicKeyBase58: string,
        noriAddressBase58: string,
        proofDataJson: MintProofDataJson,
        txFee: number,
        fundNewAccount?: boolean
    ) => '',

    /**
     * Mock mint that signs and sends using worker's mina key.
     * @param userPublicKeyBase58 - User public key (Base58)
     * @param noriAddressBase58 - Nori controller address (Base58)
     * @param proofDataJson - Mint proof data JSON (MintProofDataJson)
     * @param txFee - Fee to use for mint transaction
     * @param fundNewAccount - whether to fund new account
     * @returns Object containing txHash
     */
    MOCK_mint: async (
        userPublicKeyBase58: string,
        noriAddressBase58: string,
        proofDataJson: any,
        txFee: number,
        fundNewAccount?: boolean
    ) => ({ txHash: '' }),

    /**
     * Compile all relevant dependencies (credential, eth deposit, minter).
     */
    compileAll: async () =>
        ({ data: '', hashStr: '' } as {
            data: string;
            hashStr: string;
        }),

    /**
     * Compute a mint transaction proof and cache it inside the worker for later signing.
     * @param userPublicKeyBase58 - User public key (Base58)
     * @param noriAddressBase58 - Nori controller address (Base58)
     * @param proofDataJson - Mint proof data JSON
     * @param txFee - Fee to use for mint transaction
     * @param fundNewAccount - whether to fund new account
     */
    MOCK_computeMintProofAndCache: async (
        userPublicKeyBase58: string,
        noriAddressBase58: string,
        proofDataJson: any,
        txFee: number,
        fundNewAccount?: boolean
    ) => ({}),

    /**
     * Sign and send the previously cached mint proof transaction (worker wallet).
     * @returns Object containing txHash
     */
    WALLET_MOCK_signAndSendMintProofCache: async () => ({ txHash: '' }),
} as const;
