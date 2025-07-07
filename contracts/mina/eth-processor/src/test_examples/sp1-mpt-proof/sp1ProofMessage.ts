import { PlonkProof } from '@nori-zk/test-o1js-zk-programs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sp1ConsensusMPTPlonkProof: ProofResultResultMessage = require('./4666560-v5.0.0.json');

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
