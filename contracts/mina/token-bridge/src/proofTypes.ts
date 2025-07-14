export type PlonkInput = {
    hexPi: string;
    programVK: string;
    encodedProof: string;
}
export interface PlonkProofData {
    maxProofsVerified: 0 | 1 | 2;
    proof: string;
    publicInput: string[];
    publicOutput: string[];
}
export interface PlonkVkData {
    data: string;
    hash: string;
}
export interface PlonkOutput {
    vkData: PlonkVkData;
    proofData: PlonkProofData;
}
export interface Sp1Proof {
    Plonk: {
        encoded_proof: string;
        plonk_vkey_hash: number[];
        public_inputs: string[];
        raw_proof: string;
    };
}
export interface Sp1PublicValues {
    buffer: {
        data: number[];
    };
}
export interface Sp1 {
    proof: Sp1Proof;
    public_values: Sp1PublicValues;
    sp1_version: string;
}

export interface VerifiedContractStorageSlot {
  slot_key_address: string;
  slot_nested_key_attestation_hash: string;
  value: string;
}
export interface PlonkProofAndConvertedProofBundle {
    consensusMPTProofVerification: PlonkOutput,
    consensusMPTProof: {
        proof: Sp1,
        contract_storage_slots: VerifiedContractStorageSlot[];
    } 
}