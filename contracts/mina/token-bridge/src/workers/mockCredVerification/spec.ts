import { JsonProof } from 'o1js';

/**
 * Specification of the methods exposed by MockVerificationWorker
 * for parent proxying and testing.
 */
export const mockVerificationWorkerSpec = {
    /**
     * Compiles all required programs and contracts.
     */
    compile: async () => {},

    /**
     * Computes the end-to-end prerequisites proof from given inputs.
     * @param credentialAttestationHashBigIntStr - The credential attestation hash as a BigInt string
     * @param ethVerifierProofJson - JSON proof of the Ethereum verifier
     * @param depositAttestationProofJson - JSON proof of the contract deposit attestor
     * @returns JSON representation of the computed E2E proof
     */
    computeE2EPrerequisites: async (
        credentialAttestationHashBigIntStr: string,
        ethVerifierProofJson: JsonProof,
        depositAttestationProofJson: JsonProof
    ) => ({} as any),

    /**
     * Verifies a full end-to-end proof including Ethereum verifier proof,
     * deposit attestation proof, and ECDSA presentation.
     * @param ethVerifierProofJson - JSON proof of the Ethereum verifier
     * @param depositAttestationProofJson - JSON proof of the contract deposit attestor
     * @param presentationJsonStr - JSON string of the presentation
     * @param senderPrivateKeyBase58 - Base58-encoded sender private key
     * @param zkAppPrivateKeyBase58 - Base58-encoded zkApp private key
     */
    verify: async (
        ethVerifierProofJson: JsonProof,
        depositAttestationProofJson: JsonProof,
        presentationJsonStr: string,
        senderPrivateKeyBase58: string,
        zkAppPrivateKeyBase58: string
    ) => {},
} as const;
