import { Bytes, Field, Poseidon, Struct, UInt8 } from 'o1js';
import { Bytes20, Bytes32 } from './types.js';
import { merkleLeafAttestorGenerator } from './merkle/merkleLeafAttestor.js';

export class ContractDeposit extends Struct({
    address: Bytes20.provable,
    value: Bytes32.provable,
}) {}

export function provableStorageSlotLeafHash(contractDeposit: ContractDeposit) {
    const addressBytes = contractDeposit.address.bytes; // UInt8[]
    const valueBytes = contractDeposit.value.bytes; // UInt8[]

    // We want 20 bytes from addrBytes + 1 byte from valueBytes + remaining 31 bytes from valueBytes.

    // firstFieldBytes: 20 bytes from addressBytes + 1 byte from valueBytes.
    const firstFieldBytes: UInt8[] = [];
    for (let i = 0; i < 20; i++) {
        firstFieldBytes.push(addressBytes[i]);
    }
    firstFieldBytes.push(valueBytes[0]);

    // 21 elements; add 11 zeros.
    for (let i = 21; i < 32; i++) {
        firstFieldBytes.push(UInt8.zero); // static pad to 32
    }

    // secondFieldBytes: remaining 31 bytes from valueBytes (1 to 31).
    const secondFieldBytes: UInt8[] = [];
    for (let i = 1; i < 32; i++) {
        secondFieldBytes.push(valueBytes[i]);
    }

    // already 31 elements; add 1 zero.
    secondFieldBytes.push(UInt8.zero);

    // Convert UInt8[] to Bytes (provable bytes).
    const firstBytes = Bytes.from(firstFieldBytes);
    const secondBytes = Bytes.from(secondFieldBytes);

    // Extract the fields from their bytes (little endian).
    let firstField = new Field(0);
    let secondField = new Field(0);
    for (let i = 31; i >= 0; i--) {
        firstField = firstField.mul(256).add(firstBytes.bytes[i].value);
        secondField = secondField.mul(256).add(secondBytes.bytes[i].value);
    }

    return Poseidon.hash([firstField, secondField]);
}

const {
    MerkleTreeLeafAttestorInput: ContractDepositAttestorInput,
    MerkleTreeLeafAttestor: ContractDepositAttestor,
    buildLeaves: buildContractDepositLeaves,
    getMerklePathFromLeaves: getContractDepositWitness,
} = merkleLeafAttestorGenerator(
    16,
    'ContractStorageSlotDepositAttestor',
    ContractDeposit,
    provableStorageSlotLeafHash
);

export {
    ContractDepositAttestorInput,
    ContractDepositAttestor,
    buildContractDepositLeaves,
    getContractDepositWitness,
};
