import {
    Provable,
    VerificationKey,
    Poseidon,
    UInt8,
    Bytes,
    ZkProgram,
    Struct,
    UInt64,
    Field,
} from 'o1js';
import {
    FrC,
    NodeProofLeft,
    parsePlonkPublicInputsProvable,
} from '@nori-zk/proof-conversion';
import { bridgeHeadNoriSP1HeliosProgramPi0 } from './integrity/BridgeHead.NoriSP1HeliosProgram.pi0.js';
import { proofConversionSP1ToPlonkPO2 } from './integrity/ProofConversion.sp1ToPlonk.po2.js';
import { proofConversionSP1ToPlonkVkData } from './integrity/ProofConversion.sp1ToPlonk.vkData.js';
import { Bytes32 } from './types.js';

class EthInput extends Struct({
    inputSlot: UInt64,
    inputStoreHash: Bytes32.provable,
    outputSlot: UInt64,
    outputStoreHash: Bytes32.provable,
    executionStateRoot: Bytes32.provable,
    verifiedContractDepositsRoot: Bytes32.provable,
    nextSyncCommitteeHash: Bytes32.provable,
}) {}

const EthVerifier = ZkProgram({
    name: 'EthVerifier',
    publicInput: EthInput,
    publicOutput: Field,
    methods: {
        compute: {
            privateInputs: [NodeProofLeft],
            async method(input: EthInput, proof: NodeProofLeft) {
                // JK to swap in CI after contract gets updated and redeployed

                // This is an sp1Proof.proof.Plonk.public_inputs[0]
                // This can now be extracted from bridge head repo at location
                // nori-elf/nori-sp1-helios-program.pi0.json and should be copied to this repository
                const ethPlonkVK = FrC.from(bridgeHeadNoriSP1HeliosProgramPi0);

                // p0 = proofConversionOutput.proofData.publicOutput[2] // hash of publicOutput of sp1
                const ethNodeVk = Field.from(proofConversionSP1ToPlonkPO2);

                // Verification of proof conversion
                // vk = proofConversionOutput.vkData
                // this is also from nodeVK
                const vk = VerificationKey.fromJSON(
                    proofConversionSP1ToPlonkVkData
                );

                // [zkProgram / circuit][eth processor /  contract ie on-chain state]

                proof.verify(vk);

                // Passed proof matches extracted public entry 2
                proof.publicOutput.subtreeVkDigest.assertEquals(ethNodeVk);
                Provable.log('newHead slot', input.outputSlot);

                // Verification of the input
                let bytes: UInt8[] = [];
                bytes = bytes.concat(input.inputSlot.toBytesBE());
                bytes = bytes.concat(input.inputStoreHash.bytes);
                bytes = bytes.concat(input.outputSlot.toBytesBE());
                bytes = bytes.concat(input.outputStoreHash.bytes);
                bytes = bytes.concat(input.executionStateRoot.bytes);
                bytes = bytes.concat(input.verifiedContractDepositsRoot.bytes);
                bytes = bytes.concat(input.nextSyncCommitteeHash.bytes);

                // Check that zkprograminput is same as passed to the SP1 program
                const pi0 = ethPlonkVK; // It might be helpful for debugging to assert this seperately.
                const pi1 = parsePlonkPublicInputsProvable(Bytes.from(bytes));

                const piDigest = Poseidon.hashPacked(
                    Provable.Array(FrC.provable, 2),
                    [pi0, pi1]
                );

                Provable.log('piDigest', piDigest);
                Provable.log(
                    'proof.publicOutput.rightOut',
                    proof.publicOutput.rightOut
                );

                piDigest.assertEquals(proof.publicOutput.rightOut);

                return {
                    publicOutput: new Field(0),
                };
            },
        },
    },
});

const EthProof = ZkProgram.Proof(EthVerifier);

export { EthVerifier, EthProof, EthInput };
