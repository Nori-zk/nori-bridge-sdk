/**
 * Specification of the methods exposed by TokenDeployerWorker
 * for parent proxying.
 */
export const workerSpec = {
    /**
     * Setup Mina network instance.
     *
     * @param options - Network configuration.
     * @param options.networkId - Optional Mina network id.
     * @param options.mina - Mina node endpoint(s).
     * @param options.archive - Archive node endpoint(s).
     * @param options.lightnetAccountManager - Optional account manager.
     * @param options.bypassTransactionLimits - Whether to bypass transaction limits.
     * @param options.minaDefaultHeaders - Optional request headers for Mina.
     * @param options.archiveDefaultHeaders - Optional request headers for archive nodes.
     */
    minaSetup: async (options: {
        networkId?: any;
        mina: string | string[];
        archive?: string | string[];
        lightnetAccountManager?: string;
        bypassTransactionLimits?: boolean;
        minaDefaultHeaders?: HeadersInit;
        archiveDefaultHeaders?: HeadersInit;
    }) => {},

    /**
     * Compile all prerequisite programs and contracts used by deployment flows.
     *
     * @returns Object containing storage interface verification key data and hash string.
     */
    compile: async () =>
        ({ data: '', hashStr: '' } as { data: string; hashStr: string }),

    /**
     * Deploys NoriTokenController and TokenBase (FungibleToken) contracts and initializes TokenBase.
     *
     * @param senderPrivateKeyBase58 - Base58 private key of the transaction sender.
     * @param adminPrivateKeyBase58 - Base58 admin private key for NoriTokenController.
     * @param tokenControllerPrivateKeyBase58 - Base58 private key used for the controller contract.
     * @param tokenBasePrivateKeyBase58 - Base58 private key used for token base contract.
     * @param ethProcessorAddressBase58 - Base58 address of the eth processor contract.
     * @param storageInterfaceVerificationKeySafe - Verification key object with `data` and `hashStr`.
     * @param txFee - Fee to use for the deployment transaction.
     * @param options - Optional deployment options.
     * @param options.symbol - Token symbol (default "nETH").
     * @param options.decimals - Token decimals (default 18).
     * @param options.allowUpdates - Whether token allows updates (default true).
     * @param options.startPaused - Whether token starts paused (default false).
     *
     * @returns DeploymentResult containing deployed addresses and transaction hash.
     */
    deployContracts: async (
        senderPrivateKeyBase58: string,
        adminPrivateKeyBase58: string,
        tokenControllerPrivateKeyBase58: string,
        tokenBasePrivateKeyBase58: string,
        ethProcessorAddressBase58: string,
        storageInterfaceVerificationKeySafe: { data: string; hashStr: string },
        txFee: number,
        options?: {
            symbol?: string;
            decimals?: number;
            allowUpdates?: boolean;
            startPaused?: boolean;
        }
    ) =>
        ({
            noriTokenControllerAddress: '',
            tokenBaseAddress: '',
            txHash: '',
        } as {
            noriTokenControllerAddress: string;
            tokenBaseAddress: string;
            txHash: string;
        }),
} as const;
