import type { NoriSP1ProofInput } from '@nori-zk/pts-types';
import sp1ConsensusMPTPlonkProofRaw from './9578560-v5.0.0.json' with { type: 'json' };
const sp1ConsensusMPTPlonkProof = sp1ConsensusMPTPlonkProofRaw as WorkerOutputBridgeHeadMessage;

type VerifiedContractStorageSlot = {
    slot_key_address: string;
    slot_nested_key_attestation_hash: string;
    value: string;
};

type WorkerOutputBridgeHeadMessage = {
    input_slot: number;
    input_block_number: number;
    input_store_hash: string;
    output_slot: number;
    output_block_number: number;
    output_store_hash: string;
    proof: NoriSP1ProofInput;
    execution_state_root: string;
    contract_storage_slots: VerifiedContractStorageSlot[];
    elapsed_sec: number;
};

export { sp1ConsensusMPTPlonkProof };
