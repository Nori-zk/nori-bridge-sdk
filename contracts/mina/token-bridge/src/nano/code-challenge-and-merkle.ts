import { Bool, Field, method, SmartContract, State, state } from 'o1js';
import { verifyCodeChallenge } from '../micro/pkarm.js';
import {
    contractDepositCredentialAndTotalLockedToFields,
    getContractDepositSlotRootFromContractDepositAndWitness,
    MerkleTreeContractDepositAttestorInput,
} from '../micro/depositAttestation.js';
import { fetchContractWindowSlotProofs, buildContractDepositLeaves, ContractDeposit } from '../micro/depositAttestation.js';
import { Bytes20, Bytes32, computeMerkleTreeDepthAndSize, decodeConsensusMptProof, foldMerkleLeft, getMerklePathFromLeaves, getMerkleZeros } from '@nori-zk/o1js-zk-utils';

export class CodeChallengeAndMerkleSmartContract extends SmartContract {
    @state(Bool) mintLock = State<Bool>();
    @method
    async verifyMerkleAndChallenge(
        merkleTreeContractDepositAttestorInput: MerkleTreeContractDepositAttestorInput,
        codeVerifier: Field,
    ) {
        const contractDepositSlotRoot =
            getContractDepositSlotRootFromContractDepositAndWitness(
                merkleTreeContractDepositAttestorInput
            );

        const { totalLocked, attestationHash: codeChallenge } =
            contractDepositCredentialAndTotalLockedToFields(
                merkleTreeContractDepositAttestorInput
            );

        verifyCodeChallenge(codeVerifier, codeChallenge);
    }
}

export async function computeDepositAttestationWitness(
    depositBlockNumber: number,
    ethAddressLowerHex: string,
    attestationBEHex: string,
    domain = 'https://pcs.nori.it.com'
) {
    const {
        consensusMPTProofProof,
        consensusMPTProofContractStorageSlots,
        consensusMPTProofVerification,
    } = await fetchContractWindowSlotProofs(depositBlockNumber, domain);

    // Find deposit
    console.log(
        `Finding deposit within bundle.consensusMPTProof.contract_storage_slots`
    );
    const paddedConsensusMPTProofContractStorageSlots =
        consensusMPTProofContractStorageSlots.map((slot) => {
            return {
                //prettier-ignore
                slot_key_address: `0x${slot.slot_key_address.slice(2).padStart(40, '0')}`,
                //prettier-ignore
                slot_nested_key_attestation_hash: `0x${slot.slot_nested_key_attestation_hash.slice(2).padStart(64, '0')}`,
                //prettier-ignore
                value: `0x${slot.value.slice(2).padStart(64, '0')}`,
            };
        });
    const depositIndex = paddedConsensusMPTProofContractStorageSlots.findIndex(
        (slot) =>
            slot.slot_key_address === ethAddressLowerHex &&
            slot.slot_nested_key_attestation_hash === attestationBEHex
    );
    if (depositIndex === -1)
        throw new Error(
            `Could not find deposit index with attestationBEHex: ${attestationBEHex}, ethAddressLowerHex:${ethAddressLowerHex} in slots ${JSON.stringify(
                paddedConsensusMPTProofContractStorageSlots,
                null,
                4
            )}`
        );
    console.log(
        `Found deposit within bundle.consensusMPTProof.contract_storage_slots`
    );
    const despositSlotRaw =
        paddedConsensusMPTProofContractStorageSlots[depositIndex];
    const totalDespositedValue = despositSlotRaw.value; // this is a hex // would be nice here to print a bigint
    console.log(`Total deposited to date (hex): ${totalDespositedValue}`);

    // Build contract storage slots (to be hashed)
    const contractStorageSlots =
        paddedConsensusMPTProofContractStorageSlots.map((slot) => {
            const addr = slot.slot_key_address;
            const attr = slot.slot_nested_key_attestation_hash;
            const value = slot.value;
            console.log({ addr, attr, value });
            return new ContractDeposit({
                address: Bytes20.fromHex(addr.slice(2)),
                attestationHash: Bytes32.fromHex(attr.slice(2)),
                value: Bytes32.fromHex(value.slice(2)),
            });
        });

    // Build deposit witness

    // Build leaves
    console.time('buildContractDepositLeaves');
    const leaves = buildContractDepositLeaves(contractStorageSlots);
    console.timeEnd('buildContractDepositLeaves');
    console.log(
        'leaves',
        leaves.map((leaf) => leaf.toBigInt())
    );

    // Compute path
    console.time('getContractDepositWitness');
    const nLeaves = leaves.length;
    const { depth, paddedSize } = computeMerkleTreeDepthAndSize(nLeaves);
    const path = getMerklePathFromLeaves(
        [...leaves],
        paddedSize,
        depth,
        depositIndex,
        getMerkleZeros(depth)
    );
    console.timeEnd('getContractDepositWitness');
    console.log(
        'path',
        path.map((pathEle) => pathEle.toBigInt())
    );

    // Compute root
    console.time('foldMerkleLeft');
    const rootHash = foldMerkleLeft(
        leaves,
        paddedSize,
        depth,
        getMerkleZeros(depth)
    );
    console.timeEnd('foldMerkleLeft');
    console.log(`Computed Merkle root: ${rootHash.toString()}`);

    console.log('Loaded sp1PlonkProof and conversionOutputProof');
    const decodedInputs = decodeConsensusMptProof(consensusMPTProofProof);
    console.log(
        'decodedInputs verifiedContractDepositsRoot',
        decodedInputs.verifiedContractDepositsRoot.bytes.map((byte) =>
            byte.toNumber()
        )
    );

    return {
        depositAttestationInput: {
            path: path.map((it) => it.toBigInt().toString()),
            depositIndex,
            rootHash: rootHash.toBigInt().toString(),
            despositSlotRaw,
        },
    };
}
