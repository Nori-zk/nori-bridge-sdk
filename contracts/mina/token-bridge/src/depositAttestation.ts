import {
    buildContractDepositLeaves,
    ContractDeposit,
    ContractDepositAttestor,
    ContractDepositAttestorInput,
    ContractDepositAttestorProof,
    getContractDepositWitness,
    NodeProofLeft,
} from '@nori-zk/o1js-zk-utils';
import {
    computeMerkleTreeDepthAndSize,
    decodeConsensusMptProof,
    EthInput,
    EthVerifier,
    foldMerkleLeft,
    getMerkleZeros,
} from '@nori-zk/o1js-zk-utils';
import { Bytes20, Bytes32 } from '@nori-zk/o1js-zk-utils';
import { Sp1ProofAndConvertedProofBundle } from '@nori-zk/pts-types';
import { UInt64 } from 'o1js';

export async function compileDepositAttestationPreRequisites() {
    console.time('ContractDepositAttestor compile');
    const { verificationKey: contractDepositAttestorVerificationKey } =
        await ContractDepositAttestor.compile({ forceRecompile: true });
    console.timeEnd('ContractDepositAttestor compile');
    console.log(
        `ContractDepositAttestor contract compiled vk: '${contractDepositAttestorVerificationKey.hash}'.`
    );

    console.time('EthVerifier compile');
    const { verificationKey: ethVerifierVerificationKey } =
        await EthVerifier.compile({ forceRecompile: true });
    console.timeEnd('EthVerifier compile');
    console.log(
        `EthVerifier compiled vk: '${ethVerifierVerificationKey.hash}'.`
    );
}

async function proofConversionServiceRequest(
    depositBlockNumber: number,
    domain = 'https://pcs.nori.it.com'
): Promise<Sp1ProofAndConvertedProofBundle> {
    const fetchResponse = await fetch(
        `${domain}/converted-consensus-mpt-proofs/${depositBlockNumber}`
    );
    console.log('fetchResponse GET', fetchResponse);
    const json = await fetchResponse.json();
    console.log('parsedjson', json, typeof json);
    if ('error' in json) throw new Error(json.error as string);
    return json;
}

async function fetchContractWindowSlotProofs(depositBlockNumber: number) {
    console.log(
        `Fetching proof bundle for deposit with block number: ${depositBlockNumber}`
    );

    console.time('proofConversionServiceRequest');
    const {
        consensusMPTProof: {
            proof: consensusMPTProofProof,
            contract_storage_slots: consensusMPTProofContractStorageSlots,
        },
        consensusMPTProofVerification: consensusMPTProofVerification,
    } = await proofConversionServiceRequest(depositBlockNumber);
    console.timeEnd('proofConversionServiceRequest');

    console.log(
        'consensusMPTProofVerification, consensusMPTProofProof, consensusMPTProofContractStorageSlots',
        consensusMPTProofVerification,
        consensusMPTProofProof,
        consensusMPTProofContractStorageSlots
    );

    return {
        consensusMPTProofProof,
        consensusMPTProofContractStorageSlots,
        consensusMPTProofVerification,
    };
}

export async function computeDepositAttestation(
    depositBlockNumber: number,
    ethAddressLowerHex: string,
    attestationBEHex: string
) {
    const {
        consensusMPTProofProof,
        consensusMPTProofContractStorageSlots,
        consensusMPTProofVerification,
    } = await fetchContractWindowSlotProofs(depositBlockNumber);

    // Find deposit
    console.log(
        `Finding deposit within bundle.consensusMPTProof.contract_storage_slots`
    );
    // This can fail if there is zero padding FIXME
    /*const depositIndex = consensusMPTProofContractStorageSlots.findIndex(
        (slot) =>
            slot.slot_key_address === ethAddressLowerHex &&
            slot.slot_nested_key_attestation_hash === attestationBEHex
    );*/
    // Solution? What about as we map this after why dont we move that padding to before
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
    const despositSlotRaw = paddedConsensusMPTProofContractStorageSlots[depositIndex];
    const totalDespositedValue = despositSlotRaw.value; // this is a hex // would be nice here to print a bigint
    console.log(`Total deposited to date (hex): ${totalDespositedValue}`);

    // Build contract storage slots (to be hashed)
    // Are we sure this is ok???
    const contractStorageSlots = paddedConsensusMPTProofContractStorageSlots.map(
        (slot) => {
            const addr = slot.slot_key_address;
            const attr = slot.slot_nested_key_attestation_hash;
            const value = slot.value;
            console.log({addr, attr, value});
            return new ContractDeposit({
                address: Bytes20.fromHex(addr.slice(2)),
                attestationHash: Bytes32.fromHex(attr.slice(2)),
                value: Bytes32.fromHex(value.slice(2))
            });
            /*console.log({
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
                slot.slot_nested_key_attestation_hash.slice(2).padStart(64, '0')
            );
            const value = Bytes32.fromHex(
                slot.value.slice(2).padStart(64, '0')
            );
            return new ContractDeposit({
                address: addr,
                attestationHash: attestation,
                value,
            });*/
        }
    );
    // Select our deposit
    const depositSlot = contractStorageSlots[depositIndex];

    // Build deposit witness

    // Build leaves
    console.time('buildContractDepositLeaves');
    const leaves = buildContractDepositLeaves(contractStorageSlots);
    console.timeEnd('buildContractDepositLeaves');

    // Compute path
    console.time('getContractDepositWitness');
    const path = getContractDepositWitness([...leaves], depositIndex);
    console.timeEnd('getContractDepositWitness');

    // Compute root
    const { depth, paddedSize } = computeMerkleTreeDepthAndSize(leaves.length);
    console.time('foldMerkleLeft');
    const rootHash = foldMerkleLeft(
        leaves,
        paddedSize,
        depth,
        getMerkleZeros(depth)
    );
    console.timeEnd('foldMerkleLeft');
    console.log(`Computed Merkle root: ${rootHash.toString()}`);

    // Build ZK input
    const depositProofInput = new ContractDepositAttestorInput({
        rootHash,
        path,
        index: UInt64.from(depositIndex),
        value: depositSlot,
    });
    console.log('Prepared ContractDepositAttestorInput');

    // Prove deposit
    console.time('ContractDepositAttestor.compute');
    // Retype because of erasure at package level :(
    const depositAttestationProof = (
        await ContractDepositAttestor.compute(depositProofInput)
    ).proof as InstanceType<typeof ContractDepositAttestorProof>;

    console.timeEnd('ContractDepositAttestor.compute');

    // Verify consensus mpt proof
    console.log('Loaded sp1PlonkProof and conversionOutputProof');
    const ethVerifierInput = new EthInput(
        decodeConsensusMptProof(consensusMPTProofProof)
    );
    console.log('Decoded EthInput from MPT proof');

    console.log('Parsing raw SP1 proof using NodeProofLeft.fromJSON');

    const rawProof = await NodeProofLeft.fromJSON(
        consensusMPTProofVerification.proofData
    );
    console.log('Parsed raw SP1 proof using NodeProofLeft.fromJSON');

    console.log('Computing EthVerifier');
    console.time('EthVerifier.compute');
    const ethVerifierProof = (
        await EthVerifier.compute(ethVerifierInput, rawProof)
    ).proof;
    console.timeEnd('EthVerifier.compute');

    console.log(`All proofs built needed to compute mint proof!`);
    return { depositAttestationProof, ethVerifierProof, despositSlotRaw };
}
