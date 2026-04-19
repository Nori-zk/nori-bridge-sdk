import { Bytes, Field, Poseidon, Struct, UInt8 } from 'o1js';
import { Bytes32 } from './types.js';
import { merkleLeafAttestorGenerator } from './merkle-attestor/merkleLeafAttestor.js';

export class ContractDeposit extends Struct({
    codeChallenge: Bytes32.provable,
    value: Bytes32.provable,
}) {}

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

const {
    MerkleTreeLeafAttestorInput: ContractDepositAttestorInput,
    MerkleTreeLeafAttestor: ContractDepositAttestor,
    MerkleTreeLeafAttestorProof: ContractDepositAttestorProof,
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
    ContractDepositAttestorProof,
    buildContractDepositLeaves,
    getContractDepositWitness,
};
