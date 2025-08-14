import { PlonkProof } from '../../types';
import sp1ConsensusMPTPlonkProofRaw from './4666560-v5.0.0.json';
const sp1ConsensusMPTPlonkProof = sp1ConsensusMPTPlonkProofRaw as ProofResultResultMessage;

type ContractStorageSlot = {
    slot_key_address: string;
    slot_nested_key_attestation_hash: string;
    value: string;
};

type ProofResultResultMessage = {
    input_slot: number;
    input_store_hash: string;
    output_slot: number;
    output_store_hash: string;
    proof: PlonkProof;
    execution_state_root: string;
    contract_storage_slots: ContractStorageSlot[];
    elapsed_sec: number;
};

export { sp1ConsensusMPTPlonkProof };
