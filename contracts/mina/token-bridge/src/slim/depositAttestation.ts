import {
    Bytes20,
    EthProofType,
    Bytes32,
    computeMerkleTreeDepthAndSize,
    getMerklePathFromLeaves,
    getMerkleZeros,
    foldMerkleLeft,
} from '@nori-zk/o1js-zk-utils';
import { DynamicArray } from 'mina-attestations';
import { Sp1ProofAndConvertedProofBundle } from '@nori-zk/pts-types';
import { Bytes, Field, Poseidon, Provable, Struct, UInt64, UInt8 } from 'o1js';
// ------- Deposit attestation ---------------------------------

export class ContractDeposit extends Struct({
    address: Bytes20.provable,
    attestationHash: Bytes32.provable,
    value: Bytes32.provable,
}) {}

const treeDepth = 16;

export const MerklePath = DynamicArray(Field, { maxLength: treeDepth });

export class MerkleTreeContractDepositAttestorInput extends Struct({
    rootHash: Field,
    path: MerklePath,
    index: UInt64,
    value: ContractDeposit,
}) {}

export type MerkleTreeContractDepositAttestorInputJson = {
    depositIndex: number;
    despositSlotRaw: {
        slot_key_address: string;
        slot_nested_key_attestation_hash: string;
        value: string;
    };
    path: string[];
    rootHash: string;
};

export function buildMerkleTreeContractDepositAttestorInput(
    jsonInputs: MerkleTreeContractDepositAttestorInputJson
) {
    const merklePath = MerklePath.from([]);
    jsonInputs.path.forEach((element) =>
        merklePath.push(new Field(BigInt(element)))
    );
    return new MerkleTreeContractDepositAttestorInput({
        rootHash: new Field(BigInt(jsonInputs.rootHash)),
        path: merklePath,
        index: UInt64.fromValue(jsonInputs.depositIndex),
        value: new ContractDeposit({
            address: Bytes20.fromHex(
                jsonInputs.despositSlotRaw.slot_key_address.slice(2)
            ),
            attestationHash: Bytes32.fromHex(
                jsonInputs.despositSlotRaw.slot_nested_key_attestation_hash.slice(
                    2
                )
            ),
            value: Bytes32.fromHex(jsonInputs.despositSlotRaw.value.slice(2)),
        }),
    });
}

export function provableStorageSlotLeafHash(contractDeposit: ContractDeposit) {
    const addressBytes = contractDeposit.address.bytes; // UInt8[]
    const attestationHashBytes = contractDeposit.attestationHash.bytes; // UInt8[]
    const valueBytes = contractDeposit.value.bytes; // UInt8[]

    // We want 20 bytes from addrBytes (+ 1 byte from attBytes and 1 byte from valueBytes), remaining 31 bytes from attBytes, remaining 31 bytes from valueBytes

    // firstFieldBytes: 20 bytes from addressBytes + 1 byte from attBytes and 1 byte from valueBytes
    const firstFieldBytes: UInt8[] = [];

    for (let i = 0; i < 20; i++) {
        firstFieldBytes.push(addressBytes[i]);
    }
    firstFieldBytes.push(attestationHashBytes[0]);
    firstFieldBytes.push(valueBytes[0]);

    for (let i = 22; i < 32; i++) {
        firstFieldBytes.push(UInt8.zero); // static pad to 32
    }

    // secondFieldBytes: remaining 31 bytes from attBytes (1 to 31)
    const secondFieldBytes: UInt8[] = [];
    for (let i = 1; i < 32; i++) {
        secondFieldBytes.push(attestationHashBytes[i]);
    }

    // already 31 elements; add 1 zero to reach 32
    secondFieldBytes.push(UInt8.zero);

    // secondFieldBytes: remaining 31 bytes from valueBytes (1 to 31)
    const thirdFieldBytes: UInt8[] = [];
    for (let i = 1; i < 32; i++) {
        thirdFieldBytes.push(valueBytes[i]);
    }

    // already 31 elements; add 1 zero to reach 32
    thirdFieldBytes.push(UInt8.zero);

    // Convert UInt8[] to Bytes (provable bytes)
    const firstBytes = Bytes.from(firstFieldBytes);
    const secondBytes = Bytes.from(secondFieldBytes);
    const thirdBytes = Bytes.from(thirdFieldBytes);

    // Little endian
    let firstField = new Field(0);
    let secondField = new Field(0);
    let thirdField = new Field(0);
    for (let i = 31; i >= 0; i--) {
        firstField = firstField.mul(256).add(firstBytes.bytes[i].value);
        secondField = secondField.mul(256).add(secondBytes.bytes[i].value);
        thirdField = thirdField.mul(256).add(thirdBytes.bytes[i].value);
    }

    return Poseidon.hash([firstField, secondField, thirdField]);
}

export function attestContractDeposit(
    input: MerkleTreeContractDepositAttestorInput
) {
    let { index, path, rootHash } = input; // value

    let currentHash = provableStorageSlotLeafHash(input.value);

    const bitPath = index.value.toBits(path.maxLength);
    path.forEach((sibling, isDummy, i) => {
        const bit = bitPath[i];

        const left = Provable.if(bit, Field, sibling, currentHash);
        const right = Provable.if(bit, Field, currentHash, sibling);
        const nextHash = Poseidon.hash([left, right]);

        currentHash = Provable.if(isDummy, Field, currentHash, nextHash);
    });

    currentHash.assertEquals(rootHash);
    return currentHash;
}

// ----------------------- Verify deposit root ---------------------------
// merkleTreeContractDepositAttestorInput
export function verifyDepositAttestationRoot(
    credentialAttestationHash: Field,
    merkleTreeContractDepositAttestorInput: MerkleTreeContractDepositAttestorInput,
    ethVerifierProof: EthProofType
) {
    const ethVerifierStorageProofRootBytes =
        ethVerifierProof.publicInput.verifiedContractDepositsRoot.bytes; // I think the is BE

    // Convert verifiedContractDepositsRoot from bytes to field
    let ethVerifierStorageProofRoot = new Field(0);
    // FIXME
    // Turn into a LE field?? This seems wierd as on the rust side we have fixed_bytes[..32].copy_from_slice(&root.to_bytes());
    // And here we re-interpret the BE as LE!
    // But it does pass the test! And otherwise fails.
    for (let i = 31; i >= 0; i--) {
        ethVerifierStorageProofRoot = ethVerifierStorageProofRoot
            .mul(256)
            .add(ethVerifierStorageProofRootBytes[i].value);
    }

    // Assert roots
    Provable.asProver(() => {
        Provable.log(
            'depositAttestationProofRoot',
            'ethVerifierStorageProofRoot',
            credentialAttestationHash,
            ethVerifierStorageProofRoot
        );
    });
    credentialAttestationHash.assertEquals(ethVerifierStorageProofRoot);

    // Mock attestation assert
    const contractDepositAttestorPublicInputs =
        merkleTreeContractDepositAttestorInput.value;
    // Convert contractDepositAttestorPublicInputs.attestationHash from bytes into a field
    const contractDepositAttestorProofCredentialBytes =
        contractDepositAttestorPublicInputs.attestationHash.bytes;
    let contractDepositAttestorProofCredential = new Field(0);
    // Turn into field
    for (let i = 0; i < 32; i++) {
        contractDepositAttestorProofCredential =
            contractDepositAttestorProofCredential
                .mul(256)
                .add(contractDepositAttestorProofCredentialBytes[i].value);
    }

    Provable.asProver(() => {
        Provable.log(
            'input.credentialAttestationHash',
            'contractDepositAttestorProofCredential',
            credentialAttestationHash,
            contractDepositAttestorProofCredential
        );
    });

    credentialAttestationHash.assertEquals(
        contractDepositAttestorProofCredential
    );

    Provable.asProver(() => {
        console.log(
            contractDepositAttestorPublicInputs.value.bytes.map((byte) =>
                byte.toBigInt()
            )
        );
    });

    // Turn totalLocked into a field
    const totalLockedBytes = contractDepositAttestorPublicInputs.value.bytes;
    let totalLocked = new Field(0);
    /*for (let i = 31; i >= 0; i--) {
                    totalLocked = totalLocked
                        .mul(256)
                        .add(totalLockedBytes[i].value);
                }*/
    for (let i = 0; i < 32; i++) {
        totalLocked = totalLocked.mul(256).add(totalLockedBytes[i].value);
    }

    // Perhaps flip this??
    // We interpret contractDepositAttestorProofCredential to BE so why not this??

    const storageDepositRoot = ethVerifierStorageProofRoot;
    const attestationHash = contractDepositAttestorProofCredential;

    return {
        totalLocked,
        storageDepositRoot,
        attestationHash,
    };
}

export function buildContractDepositLeaves(
    contractDeposits: ContractDeposit[]
): Field[] {
    return contractDeposits.map((leaf) => provableStorageSlotLeafHash(leaf));
}

export function getMerklePathFromContractDeposits(
    merkleLeaves: Field[],
    index: number
) {
    const nLeaves = merkleLeaves.length;
    const { depth, paddedSize } = computeMerkleTreeDepthAndSize(nLeaves);
    const path = getMerklePathFromLeaves(
        merkleLeaves,
        paddedSize,
        depth,
        index,
        getMerkleZeros(depth)
    );
    const merklePath = MerklePath.from([]);
    path.forEach((element) => merklePath.push(element));
    return merklePath;
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

async function fetchContractWindowSlotProofs(
    depositBlockNumber: number,
    domain = 'https://pcs.nori.it.com'
) {
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
    } = await proofConversionServiceRequest(depositBlockNumber, domain);
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

export async function obtainDepositAttestationInputsJson(
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

    // Compute path
    console.time('getContractDepositWitness');
    const nLeaves = leaves.length;
    const { depth, paddedSize } = computeMerkleTreeDepthAndSize(nLeaves);
    const path = getMerklePathFromLeaves(
        leaves,
        paddedSize,
        depth,
        depositIndex,
        getMerkleZeros(depth)
    );
    console.timeEnd('getContractDepositWitness');

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

    console.log(`All proofs inputs built needed to compute mint proof!`);
    return {
        depositIndex,
        despositSlotRaw,
        path: path.map((it) => it.toBigInt().toString()),
        rootHash: rootHash.toBigInt().toString(),
        consensusMPTProofProof,
        consensusMPTProofVerification,
    };
}
