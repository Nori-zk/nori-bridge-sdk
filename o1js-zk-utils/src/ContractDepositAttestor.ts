import { Bytes, Field, Poseidon, Provable, Struct, UInt8 } from 'o1js';
import { Bytes20, Bytes32 } from './types.js';
import { merkleLeafAttestorGenerator } from './merkle-attestor/merkleLeafAttestor.js';

/**
 * @deprecated Superseded by {@link VerifiedRequest}, which namespaces a leaf by
 * the contract whose storage was proven.
 */
export class ContractDeposit extends Struct({
    codeChallenge: Bytes32.provable,
    value: Bytes32.provable,
}) {}

/**
 * @deprecated Superseded by {@link provableRequestLeafHash}.
 */
export function provableStorageSlotLeafHash(contractDeposit: ContractDeposit) {
    const codeChallengeBytes = contractDeposit.codeChallenge.bytes; // UInt8[]
    const valueBytes = contractDeposit.value.bytes; // UInt8[]

    // 64 bytes total (32 + 32), max 31 bytes per field -> 3 fields

    // firstFieldBytes: 1 byte from codeChallenge + 1 byte from value + 30 zeros
    const firstFieldBytes: UInt8[] = [];

    firstFieldBytes.push(codeChallengeBytes[0]);
    firstFieldBytes.push(valueBytes[0]);

    for (let i = 2; i < 32; i++) {
        firstFieldBytes.push(UInt8.zero); // static pad to 32
    }

    // secondFieldBytes: remaining 31 bytes from codeChallenge (1 to 31)
    const secondFieldBytes: UInt8[] = [];
    for (let i = 1; i < 32; i++) {
        secondFieldBytes.push(codeChallengeBytes[i]);
    }

    // already 31 elements; add 1 zero to reach 32
    secondFieldBytes.push(UInt8.zero);

    // thirdFieldBytes: remaining 31 bytes from value (1 to 31)
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

    /*Provable.asProver(() => {
        Provable.log('firstBytes.toFields()', firstBytes.toFields());
        Provable.log('secondBytes.toFields()', secondBytes.toFields());
        Provable.log('thirdBytes.toFields()', thirdBytes.toFields());
    });*/

    // Little endian
    let firstField = new Field(0);
    let secondField = new Field(0);
    let thirdField = new Field(0);
    for (let i = 31; i >= 0; i--) {
        firstField = firstField.mul(256).add(firstBytes.bytes[i].value);
        secondField = secondField.mul(256).add(secondBytes.bytes[i].value);
        thirdField = thirdField.mul(256).add(thirdBytes.bytes[i].value);
    }

    /*Provable.asProver(() => {
        Provable.log('(provable)firstField', firstField.toBigInt());
        Provable.log('(provable)secondField', secondField.toBigInt());
        Provable.log('(provable)thirdField', thirdField.toBigInt());
    });*/

    return Poseidon.hash([firstField, secondField, thirdField]);
}

/** Collection keys carried by one queue request. Matches the queue contract. */
export const MAX_COLLECTION_KEYS = 2;

/**
 * One proven queue request: the storage word read at the requested slot, plus
 * the identifiers the requesting contract attached to it.
 *
 * `target` is the contract whose storage was proven, stamped by the queue at
 * enqueue time. It namespaces the leaf, so a consumer reading the tree can
 * require that a leaf originated from a specific contract.
 *
 * `collectionKeys` is always two entries; those past `collectionKeysCount` are
 * zero. The count is carried separately because a zero key that was supplied is
 * a different request from a key that was never supplied.
 */
export class VerifiedRequest extends Struct({
    target: Bytes20.provable,
    collectionKeysCount: UInt8,
    collectionKeys: Provable.Array(Bytes32.provable, MAX_COLLECTION_KEYS),
    value: Bytes32.provable,
}) {}

/**
 * Hashes one verified request into a Merkle leaf.
 *
 * Packs 117 bytes into four field elements, each held under the 254-bit field
 * size, then applies Poseidon:
 *
 * - field 1: `target` (20) ‖ `collectionKeysCount` ‖ `key0[0]` ‖ `key1[0]` ‖ `value[0]`
 * - field 2: `key0[1..32]`
 * - field 3: `key1[1..32]`
 * - field 4: `value[1..32]`
 *
 * Each 32-byte array is folded little-endian, the same convention as
 * {@link provableStorageSlotLeafHash}. The SP1 guest's `hash_request_leaf`
 * packs identically; `request-leaf-vectors.json` pins the two together.
 */
export function provableRequestLeafHash(request: VerifiedRequest) {
    const targetBytes = request.target.bytes; // UInt8[20]
    const keyBytes = request.collectionKeys.map((key) => key.bytes); // UInt8[32][]
    const valueBytes = request.value.bytes; // UInt8[32]

    // 24 bytes of leading data, static-padded to 32.
    const firstFieldBytes: UInt8[] = [];
    for (let i = 0; i < 20; i++) {
        firstFieldBytes.push(targetBytes[i]);
    }
    firstFieldBytes.push(request.collectionKeysCount);
    for (let i = 0; i < MAX_COLLECTION_KEYS; i++) {
        firstFieldBytes.push(keyBytes[i][0]);
    }
    firstFieldBytes.push(valueBytes[0]);
    for (let i = 24; i < 32; i++) {
        firstFieldBytes.push(UInt8.zero);
    }

    // Each tail is the remaining 31 bytes, padded with 1 zero to reach 32.
    const tailFieldBytes = (bytes: UInt8[]) => {
        const out: UInt8[] = [];
        for (let i = 1; i < 32; i++) {
            out.push(bytes[i]);
        }
        out.push(UInt8.zero);
        return out;
    };

    const packed = [
        Bytes.from(firstFieldBytes),
        Bytes.from(tailFieldBytes(keyBytes[0])),
        Bytes.from(tailFieldBytes(keyBytes[1])),
        Bytes.from(tailFieldBytes(valueBytes)),
    ];

    // Little endian
    const fields = packed.map((bytes) => {
        let field = new Field(0);
        for (let i = 31; i >= 0; i--) {
            field = field.mul(256).add(bytes.bytes[i].value);
        }
        return field;
    });

    return Poseidon.hash(fields);
}

const {
    MerkleTreeLeafAttestorInput: ContractDepositAttestorInput,
    MerkleTreeLeafAttestor: ContractDepositAttestor,
    MerkleTreeLeafAttestorProof: ContractDepositAttestorProof,
    buildLeaves: buildContractDepositLeaves,
    getMerklePathFromLeaves: getContractDepositWitness,
} = merkleLeafAttestorGenerator(
    16,
    'ContractStorageDepositSlotAttestor',
    ContractDeposit,
    provableStorageSlotLeafHash
);

const {
    MerkleTreeLeafAttestorInput: VerifiedRequestAttestorInput,
    MerkleTreeLeafAttestor: VerifiedRequestAttestor,
    MerkleTreeLeafAttestorProof: VerifiedRequestAttestorProof,
    buildLeaves: buildVerifiedRequestLeaves,
    getMerklePathFromLeaves: getVerifiedRequestWitness,
} = merkleLeafAttestorGenerator(
    16,
    'VerifiedRequestAttestor',
    VerifiedRequest,
    provableRequestLeafHash
);

export {
    ContractDepositAttestorInput,
    ContractDepositAttestor,
    ContractDepositAttestorProof,
    buildContractDepositLeaves,
    getContractDepositWitness,
    VerifiedRequestAttestorInput,
    VerifiedRequestAttestor,
    VerifiedRequestAttestorProof,
    buildVerifiedRequestLeaves,
    getVerifiedRequestWitness,
};
