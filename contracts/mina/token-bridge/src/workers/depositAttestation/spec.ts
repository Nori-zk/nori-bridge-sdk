/**
 * Specification of the methods exposed by DepositAttestationWorker
 * for parent proxying.
 */
export const workerSpec = {
    /** Compile prerequisites for deposit attestations */
    compileAttestation: async () => {},

    /**
     * Compute a deposit attestation given the deposit details.
     * @param depositBlockNumber - The block number of the deposit
     * @param ethAddressLowerHex - Ethereum address (lowercase hex)
     * @param attestationBEHex - Attestation in big-endian hex format
     * @returns Object containing raw deposit slot and proofs in JSON
     */
    computeAttestation: async (
        depositBlockNumber: number,
        ethAddressLowerHex: string,
        attestationBEHex: string
    ) => ({
        despositSlotRaw: 0,
        depositAttestationProofJson: {},
        ethVerifierProofJson: {},
    }),

    /** Compile the EthDepositProgram and prerequisites */
    compile: async () => {},

    /**
     * Compute the full deposit proof.
     * @param presentationJson - JSON string of the presentation
     * @param depositBlockNumber - The block number of the deposit
     * @param ethAddressLowerHex - Ethereum address (lowercase hex)
     * @returns Object containing raw deposit slot and E2E proof JSON
     */
    compute: async (
        presentationJson: string,
        depositBlockNumber: number,
        ethAddressLowerHex: string
    ) => ({
        despositSlotRaw: 0,
        ethDepositProofJson: {},
    }),
} as const;
