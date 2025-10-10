import { PlonkProof } from '@nori-zk/o1js-zk-utils';
import sp1ConsensusMPTPlonkProofRaw from './8695456-v5.0.0.json' with { type: 'json' };
const sp1ConsensusMPTPlonkProof = sp1ConsensusMPTPlonkProofRaw as ProofResultResultMessage;

type ContractStorageSlot = {
    slot_key_address: string;
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
