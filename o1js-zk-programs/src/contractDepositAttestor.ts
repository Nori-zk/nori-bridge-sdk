import { Bytes, Field, Poseidon, Provable, Struct, UInt8 } from 'o1js';
import { Bytes20, Bytes32 } from './types.js';
import { merkleLeafAttestorGenerator } from './merkle-attestor/merkleLeafAttestor.js';

export class ContractDeposit extends Struct({
    address: Bytes20.provable,
    attestationHash: Bytes32.provable,
    value: Bytes32.provable,
}) {}

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

    Provable.asProver(() => {
        Provable.log('firstBytes.toFields()', firstBytes.toFields());
        Provable.log('secondBytes.toFields()', secondBytes.toFields());
        Provable.log('thirdBytes.toFields()', thirdBytes.toFields());
    });


    // Little endian
    let firstField = new Field(0);
    let secondField = new Field(0);
    let thirdField = new Field(0);
    for (let i = 31; i >= 0; i--) {
        firstField = firstField.mul(256).add(firstBytes.bytes[i].value);
        secondField = secondField.mul(256).add(secondBytes.bytes[i].value);
        thirdField = thirdField.mul(256).add(thirdBytes.bytes[i].value);
    }

    Provable.asProver(() => {
        Provable.log('(provable)firstField', firstField.toBigInt());
        Provable.log('(provable)secondField', secondField.toBigInt());
        Provable.log('(provable)thirdField', thirdField.toBigInt());
    });

    return Poseidon.hash([firstField, secondField, thirdField]);
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
