import { Logger, LogPrinter, wordToBytes } from '@nori-zk/proof-conversion';
import {
    ContractDepositAttestorInput,
    ContractDepositAttestor,
    buildContractDepositLeaves,
    getContractDepositWitness,
    ContractDeposit,
    provableStorageSlotLeafHash,
} from './contractDepositAttestor.js';
import { sp1ConsensusMPTPlonkProof } from './test-examples/sp1-mpt-proof/sp1ProofMessage.js';
import { Bytes20, Bytes32 } from './types.js';
import {
    computeMerkleTreeDepthAndSize,
    foldMerkleLeft,
    getMerkleZeros,
} from './merkle-attestor/merkleTree.js';
import { Field, UInt64 } from 'o1js';
import {
    decodeConsensusMptProof,
    fieldToHexLE,
    uint8ArrayToBigIntBE,
    uint8ArrayToBigIntLE,
} from './utils.js';
import { bytesToWord } from '@nori-zk/proof-conversion/build/src/sha/utils.js';

const logger = new Logger('ContractDepositAttestor');
new LogPrinter('[TestEthProcessor]', [
    'log',
    'info',
    'warn',
    'error',
    'debug',
    'fatal',
    'verbose',
]);

describe('Contract Storage Slot Deposit Attestor Test', () => {
    test('attestation hash calculation', () => {
        const dummyAttestationField = new Field(101);
        // Convert this field into words
        let dummyAttestationHex = fieldToHexLE(dummyAttestationField);
        console.log('dummyAttestationHex', dummyAttestationHex);
    });

    test('contract_deposit_pipeline', async () => {
        // Analyse zk program
        const contractDepositAttestorAnalysis =
            await ContractDepositAttestor.analyzeMethods();
        logger.log(
            `ContractDepositAttestor analyze methods gates length '${contractDepositAttestorAnalysis.compute.gates.length}'.`
        );

        // Build zk program
        const { verificationKey } = await ContractDepositAttestor.compile({
            forceRecompile: true,
        });
        logger.log(
            `ContractDepositAttestor contract compiled vk: '${verificationKey.hash}'.`
        );

        // Build contractStorageSlot from sp1 mpt message.
        const contractStorageSlots =
            sp1ConsensusMPTPlonkProof.contract_storage_slots.map((slot) => {
                console.log('slot', slot);
                //const valuePadded = '0x' + ((slot.value+'3f').slice(2).padStart(64, '0'));
                const valuePadded = '0x' + slot.value.slice(2).padEnd(64, '0');
                console.log('valuePadded', valuePadded);
                return new ContractDeposit({
                    address: Bytes20.fromHex(slot.slot_key_address.slice(2)),
                    attestationHash: Bytes32.fromHex(
                        slot.slot_nested_key_attestation_hash.slice(2)
                    ),
                    value: Bytes32.fromHex(valuePadded.slice(2)),
                });
            });

        // Build leaves
        const leaves = buildContractDepositLeaves(contractStorageSlots);

        // Pick an index
        let index = sp1ConsensusMPTPlonkProof.contract_storage_slots.length - 1;

        // Find Value
        const slotToFind = contractStorageSlots.find((_, idx) => idx === index);

        if (!slotToFind) throw new Error(`Slot at ${index} not found`);

                console.log('provableStorageSlotLeafHash', provableStorageSlotLeafHash(slotToFind).toBigInt().toString(16));


        // Compute path
        const path = getContractDepositWitness([...leaves], index);

        // Compute root
        const { depth, paddedSize } = computeMerkleTreeDepthAndSize(
            leaves.length
        );
        const rootHash = foldMerkleLeft(
            leaves,
            paddedSize,
            depth,
            getMerkleZeros(depth)
        );

        // Build ZK input
        const input = new ContractDepositAttestorInput({
            rootHash,
            path,
            index: UInt64.from(index),
            value: slotToFind,
        });

        logger.log(`Generated input ${JSON.stringify(input)}`);

        // Prove deposit with sample data.
        let start = Date.now();
        const output = await ContractDepositAttestor.compute(input);
        let durationMs = Date.now() - start;
        logger.log(`ContractDepositAttestor.compute took ${durationMs}ms`);

        expect(output.proof.publicOutput.toBigInt()).toBe(rootHash.toBigInt());

        const decodedProof = decodeConsensusMptProof(
            sp1ConsensusMPTPlonkProof.proof
        );
        console.log('decodedProof', decodedProof);
        const decodedProofContractDepositRootBigInt = uint8ArrayToBigIntBE(
            decodedProof.verifiedContractDepositsRoot.toBytes()
        );

        console.log(
            'decodedProofContractDepositRootBigInt hex',
            decodedProofContractDepositRootBigInt.toString(16)
        );
        //expect(output.proof.publicOutput.toBigInt()).toBe()
        console.log(
            decodedProofContractDepositRootBigInt,
            output.proof.publicOutput.toBigInt().toString(16),
            rootHash.toBigInt().toString(16)
        );

        console.log(
            decodedProofContractDepositRootBigInt,
            output.proof.publicOutput.toBigInt().toString(16),
            rootHash.toBigInt().toString(16)
        );

    });
});
