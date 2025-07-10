import {
    buildContractDepositLeaves,
    ContractDeposit,
    ContractDepositAttestor,
    ContractDepositAttestorInput,
    getContractDepositWitness,
    EthInput,
    EthProof,
    EthVerifier,
    computeMerkleTreeDepthAndSize,
    foldMerkleLeft,
    getMerkleZeros,
    decodeConsensusMptProof,
    Bytes20,
    Bytes32,
    ContractDepositAttestorProof,
} from '@nori-zk/o1js-zk-utils';
import { bridgeHeadJobSucceededExample } from './test_examples/4666560/bridgeHeadJobSucceeded.js';
import proofArgument from './test_examples/4666560/index.js';
import { Field, Struct, UInt64, ZkProgram } from 'o1js';
import { NodeProofLeft } from '@nori-zk/proof-conversion';

const mptConsensusProofBundle = proofArgument;
const bridgeHeadJobSucceededMessage = bridgeHeadJobSucceededExample;

class E2ePrerequisitesInput extends Struct({
    ethVerifierProof: EthProof,
    contractDepositAttestorProof: ContractDepositAttestorProof,
    credentialAttestationHash: Field,
    // AttestationHash (as temporary input) [this is not no how we will do it but good for test]
    // ...???? CredentialAttestaionProof (private credential ) -> output owner of private (public key.... MINA)
    // COULD BE HASH OF THIS PROOF..... IGNORE THIS FOR THIS TEST
}) {}

class E2ePrerequisitesOutput extends Struct({
    totalLocked: Field,
    storageDepositRoot: Field,
    attestationHash: Field,
}) {}

const E2EPrerequisitesProgram = ZkProgram({
    name: 'E2EPrerequisites',
    publicInput: E2ePrerequisitesInput,
    publicOutput: E2ePrerequisitesOutput,
    methods: {
        compute: {
            privateInputs: [],
            async method(input: E2ePrerequisitesInput) {
                // proof 1 proof 2 /// atteesnation hash

                // verify x2
                input.contractDepositAttestorProof.verify();
                input.ethVerifierProof.verify();

                // Extract roots from public inputs

                const depositAttestationProofRoot =
                    input.contractDepositAttestorProof.publicOutput;
                const ethVerifierStorageProofRootBytes =
                    input.ethVerifierProof.publicInput
                        .verifiedContractDepositsRoot.bytes; // I think the is BE

                // Convert verifiedContractDepositsRoot from bytes to field
                let ethVerifierStorageProofRoot = new Field(0);
                // Turn into a LE field??
                for (let i = 31; i >= 0; i--) {
                    ethVerifierStorageProofRoot = ethVerifierStorageProofRoot
                        .mul(256)
                        .add(ethVerifierStorageProofRootBytes[i].value);
                }

                // Assert roots
                depositAttestationProofRoot.assertEquals(
                    ethVerifierStorageProofRoot
                );

                // Mock attestation assert
                const contractDepositAttestorPublicInputs = input
                    .contractDepositAttestorProof.publicInput
                    .value as unknown as ContractDeposit;
                // Convert contractDepositAttestorPublicInputs.attestationHash from bytes into a field
                const contractDepositAttestorProofCredentialBytes =
                    contractDepositAttestorPublicInputs.attestationHash.bytes;
                let contractDepositAttestorProofCredential = new Field(0);
                // Turn into a LE field??
                for (let i = 31; i >= 0; i--) {
                    contractDepositAttestorProofCredential =
                        contractDepositAttestorProofCredential
                            .mul(256)
                            .add(
                                contractDepositAttestorProofCredentialBytes[i]
                                    .value
                            );
                }
                input.credentialAttestationHash.assertEquals(
                    contractDepositAttestorProofCredential
                );

                // Turn totalLocked into a field
                const totalLockedBytes =
                    contractDepositAttestorPublicInputs.value.bytes;
                let totalLocked = new Field(0);
                for (let i = 31; i >= 0; i--) {
                    totalLocked = totalLocked
                        .mul(256)
                        .add(totalLockedBytes[i].value);
                }

                // value (amount), execution root, storage desposit root, attestation hash

                const storageDepositRoot = ethVerifierStorageProofRoot;
                const attestationHash = contractDepositAttestorProofCredential;

                return {
                    publicOutput: new E2ePrerequisitesOutput({
                        totalLocked,
                        storageDepositRoot,
                        attestationHash,
                    }),
                };
            },
        },
    },
});

describe('e2e_prerequisites', () => {
    test('e2e_prerequisites_pipeline', async () => {
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
        const e2ePrerequisitesProgramMethods =
            await E2EPrerequisitesProgram.analyzeMethods();
        console.log(
            'e2ePrerequisitesProgramMethods',
            e2ePrerequisitesProgramMethods.compute
        );

        // Compile E2EPrerequisitesProgram
        const { verificationKey: e2ePrerequisitesVerificationKey } =
            await E2EPrerequisitesProgram.compile({
                forceRecompile: true,
            });
        console.log(
            `E2EPrerequisitesProgram contract compiled vk: '${e2ePrerequisitesVerificationKey.hash}'.`
        );

        // Build deposit leave values (to be hashed)
        const contractStorageSlots =
            bridgeHeadJobSucceededMessage.contract_storage_slots.map((slot) => {
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
        // Turn into a LE field??
        for (let i = 31; i >= 0; i--) {
            credentialAttestationHash = credentialAttestationHash
                .mul(256)
                .add(slotToFind.attestationHash.bytes[i].value);
        }
        console.log(
            `Computed credentialAttestationHash: ${credentialAttestationHash.toString()}`
        );

        // Build E2ePrerequisitesInput

        const e2ePrerequisitesInput = new E2ePrerequisitesInput({
            ethVerifierProof: ethVerifierProof.proof,
            contractDepositAttestorProof: depositAttestationProof.proof,
            credentialAttestationHash,
        });
        console.log('Constructed E2ePrerequisitesInput');

        // Compute e2e pre-requisites proof
        start = Date.now();
        const e2ePrerequisitesProof = await E2EPrerequisitesProgram.compute(
            e2ePrerequisitesInput
        );
        console.log(
            `E2EPrerequisitesProgram.compute took ${Date.now() - start}ms`
        );
        console.log('Computed E2EPrerequisitesProgram proof');
        console.log(
            `E2E publicOutput.totalLocked: ${e2ePrerequisitesProof.proof.publicOutput.totalLocked.toString()}`
        );
        console.log(
            `E2E publicOutput.storageDepositRoot: ${e2ePrerequisitesProof.proof.publicOutput.storageDepositRoot.toString()}`
        );
        console.log(
            `E2E publicOutput.attestationHash: ${e2ePrerequisitesProof.proof.publicOutput.attestationHash.toString()}`
        );

        // make types for the programs which are the program proofs output from compute....
        // we have that from eth verifier already EthProof
        // its absent from contract deposit attestor so add this

        // then these are inputs to E2EPrerequisitesProgram they are private inputs and then become available to the compute method
        // if we make them public inputs we can access them after doing the proof without outputing them
    });
});
