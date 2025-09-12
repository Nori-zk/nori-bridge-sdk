import {
    buildContractDepositLeaves,
    ContractDeposit,
    ContractDepositAttestor,
    ContractDepositAttestorInput,
    getContractDepositWitness,
    EthInput,
    EthVerifier,
    computeMerkleTreeDepthAndSize,
    foldMerkleLeft,
    getMerkleZeros,
    decodeConsensusMptProof,
    Bytes20,
    Bytes32,
    fieldToBigIntLE,
    fieldToHexLE,
    fieldToHexBE,
} from '@nori-zk/o1js-zk-utils';
import { EthProcessor } from '@nori-zk/ethprocessor/browser';
import { bridgeHeadJobSucceededExample } from './test_examples/4666560/bridgeHeadJobSucceeded.js';
import proofArgument from './test_examples/4666560/index.js';
import { Field, UInt64, Bytes } from 'o1js';
import { NodeProofLeft, wordToBytes } from '@nori-zk/proof-conversion';
import { uint8ArrayToBigIntBE } from '@nori-zk/o1js-zk-utils';
import {
    E2ePrerequisitesInput,
    E2EPrerequisitesProgram,
} from './e2ePrerequisites.js';

const mptConsensusProofBundle = proofArgument;
const bridgeHeadJobSucceededMessage = bridgeHeadJobSucceededExample;

function hexStringToUint8Array(hex: string): Uint8Array {
    if (hex.startsWith('0x')) hex = hex.slice(2);
    if (hex.length % 2 !== 0) hex = '0' + hex; // pad to full bytes
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
    }
    return bytes;
}

describe('e2e_prerequisites', () => {
    test('import_eth_processor', async () => {
        console.log(EthProcessor);
    });
    test('hex_field_hex_round_trip', async () => {
        // Lets start with a field
        //const field = new Field(25300000000000000000000000000000000000000000000000000000000000000000000000001n);

        //const field = new Field(21888242871839275222246405745257275088548364400416034343698204186575808495617n);
        const field = new Field(
            31888242871839275222246405745257275088548364400416034343698204186575808495618n
        );
        // Convert it to a hex value
        const originalBEHex = `0x${Bytes.from(
            wordToBytes(field, 32).reverse()
        ).toHex()}`;
        console.log('OriginalHex', originalBEHex);
        // Convert back to bytes
        const obeBytes = Bytes.fromHex(originalBEHex.slice(2));

        // Interpret it as little endian field
        let leField = new Field(0);
        for (let i = 31; i >= 0; i--) {
            leField = leField.mul(256).add(obeBytes.bytes[i].value);
        }

        // Convert this back to bytes
        const leBytes = Bytes.from(wordToBytes(leField, 32));
        // And back to hex
        const convertedHex = `0x${leBytes.toHex()}`;

        console.log('ConvertedHex', convertedHex);

        expect(convertedHex).toEqual(originalBEHex);
    });

    test('hex_field_hex_round_trip_preserve"', async () => {
        // Lets start with a field
        //const field = new Field(25300000000000000000000000000000000000000000000000000000000000000000000000001n);

        //const field = new Field(21888242871839275222246405745257275088548364400416034343698204186575808495617n);
        const field = new Field(
            31888242871839275222246405745257275088548364400416034343698204186575808495618n
        );
        // Convert it to a hex value
        const originalBEHex = `0x${Bytes.from(
            wordToBytes(field, 32).reverse()
        ).toHex()}`;
        console.log('OriginalHex', originalBEHex);
        // Convert back to bytes
        const obeBytes = Bytes.fromHex(originalBEHex.slice(2));
        const oleBytes = obeBytes.bytes.reverse();

        // Interpret it as little endian field
        let leField = new Field(0);
        for (let i = 31; i >= 0; i--) {
            leField = leField.mul(256).add(oleBytes[i].value);
        }

        // Convert this back to bytes
        const leBytes = Bytes.from(wordToBytes(leField, 32));
        // Convert back to be bytes
        const beByte = Bytes.from(leBytes.bytes.reverse());

        // And back to hex
        const convertedHex = `0x${beByte.toHex()}`;

        console.log('ConvertedHex', convertedHex);

        expect(convertedHex).toEqual(originalBEHex);
    });

    test('hex_field_hex_round_trip_real_example"', async () => {
        // Convert it to a hex value
        const originalBEHex = `0x20cceb5b591e742c13fd7f3894f97139c964606f2928eefdc234e8a3a55c10b2`;
        console.log('OriginalHex', originalBEHex);
        // Convert back to bytes
        const obeBytes = Bytes.fromHex(originalBEHex.slice(2));
        const oleBytes = obeBytes.bytes.reverse();

        // Interpret it as little endian field
        let leField = new Field(0);
        for (let i = 31; i >= 0; i--) {
            leField = leField.mul(256).add(oleBytes[i].value);
        }

        // Convert this back to bytes
        const leBytes = Bytes.from(wordToBytes(leField, 32));
        // Convert back to be bytes
        const beByte = Bytes.from(leBytes.bytes.reverse());

        // And back to hex
        const convertedHex = `0x${beByte.toHex()}`;

        console.log('ConvertedHex', convertedHex);

        expect(convertedHex).toEqual(originalBEHex);
    });

    test('e2e_prerequisites_pipeline', async () => {
        console.log(
            'bridgeHeadJobSucceededMessage.contract_storage_slots',
            bridgeHeadJobSucceededMessage.contract_storage_slots
        );
        // Build deposit leave values (to be hashed)
        const contractStorageSlots =
            bridgeHeadJobSucceededMessage.contract_storage_slots.map((slot) => {
                console.log({
                    add: slot.slot_key_address.slice(2).padStart(40, '0'),
                    attr: slot.slot_nested_key_attestation_hash
                        .slice(2)
                        .padStart(64, '0'),
                    value: slot.value.slice(2).padStart(64, '0'),
                });
                const addr = Bytes20.fromHex(
                    slot.slot_key_address.slice(2).padStart(40, '0')
                );
                const attestation = Bytes32.fromHex(
                    slot.slot_nested_key_attestation_hash
                        .slice(2)
                        .padStart(64, '0')
                );
                const value = Bytes32.fromHex(
                    slot.value.slice(2).padStart(64, '0')
                );
                return new ContractDeposit({
                    address: addr,
                    attestationHash: attestation,
                    value,
                });
            });
        console.log('Built contractStorageSlots');

        // Compile ZKs

        const { verificationKey: contractDepositAttestorVerificationKey } =
            await ContractDepositAttestor.compile({
                forceRecompile: true,
            });
        console.log(
            `ContractDepositAttestor contract compiled vk: '${contractDepositAttestorVerificationKey.hash}'.`
        );

        const { verificationKey: ethVerifierVerificationKey } =
            await EthVerifier.compile({ forceRecompile: true });
        console.log(
            `EthVerifier compiled vk: '${ethVerifierVerificationKey.hash}'.`
        );

        // Analysing methods for E2EPrerequisitesProgram
        /*const e2ePrerequisitesProgramMethods =
            await E2EPrerequisitesProgram.analyzeMethods();
        console.log(
            'e2ePrerequisitesProgramMethods',
            e2ePrerequisitesProgramMethods.compute
        );*/

        // Compile E2EPrerequisitesProgram
        const { verificationKey: e2ePrerequisitesVerificationKey } =
            await E2EPrerequisitesProgram.compile({
                forceRecompile: true,
            });
        console.log(
            `E2EPrerequisitesProgram contract compiled vk: '${e2ePrerequisitesVerificationKey.hash}'.`
        );

        // Build leaves
        const leaves = buildContractDepositLeaves(contractStorageSlots);
        console.log('Built deposit leaves');

        // Pick an index
        let index =
            bridgeHeadJobSucceededMessage.contract_storage_slots.length - 1;
        console.log(`Selected index ${index}`);

        // Find Value
        const slotToFind = contractStorageSlots.find((_, idx) => idx === index);
        if (!slotToFind) throw new Error(`Slot at ${index} not found`);
        console.log('Found target contract deposit slot');

        // Compute path
        const path = getContractDepositWitness([...leaves], index);
        console.log('Computed Merkle witness path');

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
        console.log(`Computed Merkle root: ${rootHash.toString()}`);

        // Build ZK input
        const depositProofInput = new ContractDepositAttestorInput({
            rootHash,
            path,
            index: UInt64.from(index),
            value: slotToFind,
        });
        console.log('Prepared ContractDepositAttestorInput');

        // Prove deposit with sample data.
        let start = Date.now();
        const depositAttestationProof = await ContractDepositAttestor.compute(
            depositProofInput
        );
        let durationMs = Date.now() - start;
        console.log(`ContractDepositAttestor.compute took ${durationMs}ms`);

        // Converted proof verification

        const { sp1PlonkProof, conversionOutputProof } =
            mptConsensusProofBundle;
        console.log('Loaded sp1PlonkProof and conversionOutputProof');

        const ethVerifierInput = new EthInput(
            decodeConsensusMptProof(sp1PlonkProof)
        );
        console.log('Decoded EthInput from MPT proof');

        // @ts-ignore this is silly! why!
        const rawProof = await NodeProofLeft.fromJSON(
            conversionOutputProof.proofData
        );
        console.log('Parsed raw SP1 proof using NodeProofLeft.fromJSON');

        start = Date.now();
        const ethVerifierProof = await EthVerifier.compute(
            ethVerifierInput,
            rawProof
        );
        console.log(`EthVerifier.compute took ${Date.now() - start}ms`);

        // MOCK convert attestation bytes into a field
        let credentialAttestationHash = new Field(0);
        // Turn into a field
        for (let i = 0; i < 32; i++) {
            credentialAttestationHash = credentialAttestationHash
                .mul(256)
                .add(slotToFind.attestationHash.bytes[i].value);
        }
        console.log(
            `Computed credentialAttestationHash: ${credentialAttestationHash.toString()}`
        );

        // Build E2ePrerequisitesInput

        const e2ePrerequisitesInput = new E2ePrerequisitesInput({
            //ethVerifierProof: ethVerifierProof.proof,
            //contractDepositAttestorProof: depositAttestationProof.proof,
            credentialAttestationHash,
        });
        console.log('Constructed E2ePrerequisitesInput');

        // Compute e2e pre-requisites proof
        start = Date.now();
        const e2ePrerequisitesProof = await E2EPrerequisitesProgram.compute(
            e2ePrerequisitesInput,
            ethVerifierProof.proof,
            depositAttestationProof.proof
        );
        console.log(
            `E2EPrerequisitesProgram.compute took ${Date.now() - start}ms`
        );
        console.log('Computed E2EPrerequisitesProgram proof');

        const { totalLocked, storageDepositRoot, attestationHash } =
            e2ePrerequisitesProof.proof.publicOutput;

        console.log('--- Decoded public output ---');
        // Both of these look fine:
        console.log(
            `proved   totalLocked (LE bigint): ${fieldToBigIntLE(totalLocked)}`
        );
        console.log(
            'original totalLocked (BE bigint)',
            uint8ArrayToBigIntBE(
                hexStringToUint8Array(
                    bridgeHeadJobSucceededMessage.contract_storage_slots[index]
                        .value
                )
            )
        );

        // Would need to re-extract this
        console.log(
            `storageDepositRoot (LE hex): ${fieldToHexLE(storageDepositRoot)}`
        );
        console.log(
            `storageDepositRoot (BE hex): ${fieldToHexBE(storageDepositRoot)}`
        );

        // These dont have one reconstructing to the original contract_storage_slots but they do atleast match credentialAttestationHash
        // Think about this...
        console.log(
            `attestationHash (LE hex): ${fieldToHexLE(attestationHash)}`
        );
        console.log(
            `attestationHash (BE hex): ${fieldToHexBE(attestationHash)}`
        );
        console.log(
            `attestationHash (BE hex): ${fieldToHexBE(attestationHash)}`
        );

        console.log(Bytes.from(wordToBytes(attestationHash, 32)).toHex());

        // credentialAttestationHash

        console.log(
            `credentialAttestationHash (LE hex): ${fieldToHexLE(
                credentialAttestationHash
            )}`
        );
        console.log(
            `credentialAttestationHash (BE hex): ${fieldToHexBE(
                credentialAttestationHash
            )}`
        );
        console.log(
            Bytes.from(wordToBytes(credentialAttestationHash, 32)).toHex()
        );

        console.log('--------------------------------compare to....');

        console.log(bridgeHeadJobSucceededMessage.contract_storage_slots);
    });
});
