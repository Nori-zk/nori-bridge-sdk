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
    attestationHash: Field
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

        const depositAttestationProofRoot = input.contractDepositAttestorProof.publicOutput;
        const ethVerifierStorageProofRootBytes = input.ethVerifierProof.publicInput.verifiedContractDepositsRoot.bytes; // I think the is BE
        
        // Convert verifiedContractDepositsRoot from bytes to field
        let ethVerifierStorageProofRoot = new Field(0);
        // Turn into a LE field??
        for (let i = 31; i >= 0; i--) {
            ethVerifierStorageProofRoot = ethVerifierStorageProofRoot.mul(256).add(ethVerifierStorageProofRootBytes[i].value);
        }

        // Assert roots
        depositAttestationProofRoot.assertEquals(ethVerifierStorageProofRoot);

        // Mock attestation assert
        const contractDepositAttestorPublicInputs = input.contractDepositAttestorProof.publicInput.value as unknown as ContractDeposit;
        // Convert contractDepositAttestorPublicInputs.attestationHash from bytes into a field
        const contractDepositAttestorProofCredentialBytes = contractDepositAttestorPublicInputs.attestationHash.bytes;
        let contractDepositAttestorProofCredential = new Field(0);
        // Turn into a LE field??
        for (let i = 31; i >= 0; i--) {
            contractDepositAttestorProofCredential = contractDepositAttestorProofCredential.mul(256).add(contractDepositAttestorProofCredentialBytes[i].value);
        }
        input.credentialAttestationHash.assertEquals(contractDepositAttestorProofCredential);

        // Turn totalLocked into a field
        const totalLockedBytes = contractDepositAttestorPublicInputs.value.bytes; 
        let totalLocked = new Field(0);
        for (let i = 31; i >= 0; i--) {
            totalLocked = totalLocked.mul(256).add(totalLockedBytes[i].value);
        }
        
        // value (amount), execution root, storage desposit root, attestation hash

        const storageDepositRoot = ethVerifierStorageProofRoot;
        const attestationHash = contractDepositAttestorProofCredential;

        return {
          publicOutput: new E2ePrerequisitesOutput({
            totalLocked,
            storageDepositRoot,
            attestationHash
          })
        };
      },
    },
  },
});

describe('e2e_prerequisites', () => {
  test('pipeline', async () => {
    const { verificationKey: contractDepositAttestorVerificationKey } =
      await ContractDepositAttestor.compile({
        forceRecompile: true,
      });
    console.log(
      `ContractDepositAttestor contract compiled vk: '${contractDepositAttestorVerificationKey.hash}'.`
    );

    // Build deposit leave values (to be hashed)
    const contractStorageSlots =
      bridgeHeadJobSucceededMessage.contract_storage_slots.map((slot) => {
        const addr = Bytes20.fromHex(
          slot.slot_key_address.slice(2).padStart(40, '0')
        );
        const attestation = Bytes32.fromHex(
          slot.slot_nested_key_attestation_hash.slice(2).padStart(64, '0')
        );
        const value = Bytes32.fromHex(slot.value.slice(2).padStart(64, '0'));
        return new ContractDeposit({
          address: addr,
          attestationHash: attestation,
          value,
        });
      });

    // Build leaves
    const leaves = buildContractDepositLeaves(contractStorageSlots);

    // Pick an index
    let index = bridgeHeadJobSucceededMessage.contract_storage_slots.length - 1;

    // Find Value
    const slotToFind = contractStorageSlots.find((_, idx) => idx === index);
    if (!slotToFind) throw new Error(`Slot at ${index} not found`);

    // Compute path
    const path = getContractDepositWitness([...leaves], index);

    // Compute root
    const { depth, paddedSize } = computeMerkleTreeDepthAndSize(leaves.length);
    const rootHash = foldMerkleLeft(
      leaves,
      paddedSize,
      depth,
      getMerkleZeros(depth)
    );

    // Build ZK input
    const depositProofInput = new ContractDepositAttestorInput({
      rootHash,
      path,
      index: UInt64.from(index),
      value: slotToFind,
    });

    // Prove deposit with sample data.
    let start = Date.now();
    const depositAttestationProof = await ContractDepositAttestor.compute(
      depositProofInput
    );
    let durationMs = Date.now() - start;
    console.log(`ContractDepositAttestor.compute took ${durationMs}ms`);

    // Converted proof verification
    const { verificationKey: ethVerifierVerificationKey } =
      await EthVerifier.compile({ forceRecompile: true });
    console.log(
      `EthVerifier compiled vk: '${ethVerifierVerificationKey.hash}'.`
    );

    const { sp1PlonkProof, conversionOutputProof } = mptConsensusProofBundle;

    const ethVerifierInput = new EthInput(
      decodeConsensusMptProof(sp1PlonkProof)
    );

    // ts-ignore this is silly! why!
    const rawProof = await NodeProofLeft.fromJSON(
      conversionOutputProof.proofData
    );

    const ethVerifierProof = await EthVerifier.compute(ethVerifierInput, rawProof);

    // MOCK convert attestation bytes into a field
    let credentialAttestionHash = new Field(0);
    // Turn into a LE field??
    for (let i = 31; i >= 0; i--) {
        credentialAttestionHash = credentialAttestionHash.mul(256).add(slotToFind.attestationHash.bytes[i].value);
    }

    // Compile E2EPrerequisitesProgram
    const { verificationKey: e2ePrerequisitesVerificationKey } =
      await E2EPrerequisitesProgram.compile({
        forceRecompile: true,
      });
    console.log(
      `E2EPrerequisitesProgram contract compiled vk: '${e2ePrerequisitesVerificationKey.hash}'.`
    );

    // Build E2ePrerequisitesInput

    const e2ePrerequisitesInput = new E2ePrerequisitesInput({
        ethVerifierProof: ethVerifierProof,
        contractDepositAttestorProof: depositAttestationProof,
        credentialAttestionHash
    });

    // Compute e2e pre-requisites proof
    const e2ePrerequisitesProof = await E2EPrerequisitesProgram.compute(e2ePrerequisitesInput);

    // make types for the programs which are the program proofs output from compute....
    // we have that from eth verifier already EthProof
    // its absent from contract deposit attestor so add this

    // then these are inputs to E2EPrerequisitesProgram they are private inputs and then become available to the compute method
    // if we make them public inputs we can access them after doing the proof without outputing them
  });
});
