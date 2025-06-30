import { Bytes, Field, Poseidon, Struct, UInt8 } from 'o1js';
import { Bytes20, Bytes32 } from '../types.js';

export function dummyAddress(byte: number): Bytes20 {
    const arr = new Uint8Array(20).fill(byte);
    return Bytes20.from(arr);
}

export function dummyValue(byte: number): Bytes32 {
    const arr = new Uint8Array(32).fill(byte);
    return Bytes32.from(arr);
}

export function nonProvableStorageSlotLeafHash(
    addr: Bytes20,
    value: Bytes32
): Field {
    const addrBytes = addr.toBytes();
    const valueBytes = value.toBytes();

    const firstFieldBytes = new Uint8Array(32);
    firstFieldBytes.set(addrBytes, 0); // first 20 bytes from address
    firstFieldBytes[20] = valueBytes[0]; // 21st byte from value

    const secondFieldBytes = new Uint8Array(32);
    secondFieldBytes.set(valueBytes.slice(1, 32), 0); // remaining 31 bytes from value

    const firstField = Field.fromBytes(Array.from(firstFieldBytes));
    const secondField = Field.fromBytes(Array.from(secondFieldBytes));

    return Poseidon.hash([firstField, secondField]);
}

// Build leaf hashes from pairs of (Address, FixedBytes32)
export function buildLeavesNonProvable(
    pairs: Array<[Bytes20, Bytes32]>
): Field[] {
    return pairs.map(([addr, val]) =>
        nonProvableStorageSlotLeafHash(addr, val)
    );
}

export class ProvableLeafObject extends Struct({
    bytes20: Bytes20.provable,
    bytes32: Bytes32.provable,
}) {}

export function provableLeafContentsHash(leafContents: ProvableLeafObject) {
    const addressBytes = leafContents.bytes20.bytes; // UInt8[]
    const valueBytes = leafContents.bytes32.bytes; // UInt8[]

    /*Provable.asProver(() => {
        Provable.log('addressBytes', addressBytes);
        Provable.log('valueBytes', valueBytes);
    });*/

    // We want 20 bytes from addrBytes + 1 byte from valueBytes + remaining 31 bytes from valueBytes

    // firstFieldBytes: 20 bytes from addressBytes + 1 byte from valueBytes
    const firstFieldBytes: UInt8[] = [];

    for (let i = 0; i < 20; i++) {
        firstFieldBytes.push(addressBytes[i]);
    }
    firstFieldBytes.push(valueBytes[0]);

    for (let i = 21; i < 32; i++) {
        firstFieldBytes.push(UInt8.zero); // static pad to 32
    }

    // secondFieldBytes: remaining 31 bytes from valueBytes (1 to 31)
    const secondFieldBytes: UInt8[] = [];
    for (let i = 1; i < 32; i++) {
        secondFieldBytes.push(valueBytes[i]);
    }

    // already 31 elements; add 1 zero to reach 32
    secondFieldBytes.push(UInt8.zero);

    // Convert UInt8[] to Bytes (provable bytes)
    const firstBytes = Bytes.from(firstFieldBytes);
    const secondBytes = Bytes.from(secondFieldBytes);

    // Extract the first field (there should only ever be one here)
    /*Provable.asProver(() => {
        Provable.log('firstBytes.toFields()', firstBytes.toFields());
        Provable.log('secondBytes.toFields()', secondBytes.toFields());
    });*

    // this is assuming big endian ??

    /*let firstField = new Field(0);
    let secondField = new Field(0);
    for (let i = 0; i < 32; i++) {
        firstField = firstField.mul(256).add(firstBytes.bytes[i].value);
        secondField = secondField.mul(256).add(secondBytes.bytes[i].value);
    }*/

    // implement little endian here instead...
    let firstField = new Field(0);
    let secondField = new Field(0);
    for (let i = 31; i >= 0; i--) {
        firstField = firstField.mul(256).add(firstBytes.bytes[i].value);
        secondField = secondField.mul(256).add(secondBytes.bytes[i].value);
    }

    /*Provable.asProver(() => {
        Provable.log('(provable)firstField', firstField.toBigInt());
        Provable.log('(provable)secondField', secondField.toBigInt());
    });*/

    return Poseidon.hash([firstField, secondField]);
}
