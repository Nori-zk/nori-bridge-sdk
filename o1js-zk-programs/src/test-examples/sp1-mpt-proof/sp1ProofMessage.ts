import { PlonkProof } from '../../types';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sp1ConsensusMPTPlonkProof: ProofResultResultMessage = require('./mock-4412702-v4.0.0-rc.3.json');

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
