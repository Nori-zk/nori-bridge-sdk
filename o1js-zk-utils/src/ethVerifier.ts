import {
    Provable,
    VerificationKey,
    Poseidon,
    type UInt8,
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
} from '@nori-zk/proof-conversion/min';
import { bridgeHeadNoriSP1HeliosProgramPi0 } from './integrity/BridgeHead.NoriSP1HeliosProgram.pi0.js';
import { proofConversionSP1ToPlonkPO2 } from './integrity/ProofConversion.sp1ToPlonk.po2.js';
import { proofConversionSP1ToPlonkVkData } from './integrity/ProofConversion.sp1ToPlonk.vkData.js';
import { Bytes20, Bytes32 } from './types.js';

class EthInput extends Struct({
    inputSlot: UInt64,
    inputStoreHash: Bytes32.provable,
    outputSlot: UInt64,
    outputStoreHash: Bytes32.provable,
    executionStateRoot: Bytes32.provable,
    verifiedContractDepositsRoot: Bytes32.provable,
    nextSyncCommitteeHash: Bytes32.provable,
    contractAddress: Bytes20.provable,
    genesisRoot: Bytes32.provable,
}) { }

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
                const vk = VerificationKey.fromValue({
                    data: proofConversionSP1ToPlonkVkData.data,
                    hash: Field(proofConversionSP1ToPlonkVkData.hash),
                }
                    // "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",

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
                bytes = bytes.concat(input.contractAddress.bytes);
                bytes = bytes.concat(input.genesisRoot.bytes);

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

export class EthProofType extends EthProof { }

export { EthVerifier, EthProof, EthInput };
