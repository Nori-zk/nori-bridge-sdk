import { Bytes, Field, Poseidon, Provable, Struct, UInt8 } from 'o1js';
import { Bytes20, Bytes32 } from '../types.js';

export function dummyAddress(i: number): Bytes20 {
    const arr = new Uint8Array(20).fill(0);
    const view = new DataView(arr.buffer);
    view.setUint32(16, i, true); // little-endian, last 4 bytes
    return Bytes20.from(arr);
}

export function dummyAttestation(i: number): Bytes32 {
    const arr = new Uint8Array(32).fill(0);
    const view = new DataView(arr.buffer);
    view.setUint32(0, i, true); // little-endian, first 4 bytes
    return Bytes32.from(arr);
}

export function dummyValue(i: number): Bytes32 {
    const arr = new Uint8Array(32).fill(0);
    const view = new DataView(arr.buffer);
    view.setUint32(0, i, true); // little-endian, first 4 bytes
    return Bytes32.from(arr);
}

export function nonProvableStorageSlotLeafHash(
    addr: Bytes20,
    attestation: Bytes32,
    value: Bytes32
): Field {
    const addrBytes = addr.toBytes();
    const attBytes = attestation.toBytes().reverse();
    const valueBytes = value.toBytes();

    const firstFieldBytes = new Uint8Array(32);
    firstFieldBytes.set(addrBytes, 0); // first 20 bytes from address
    firstFieldBytes[20] = attBytes[0]; // first byte from attBytes
    firstFieldBytes[21] = valueBytes[0]; // first byte from value

    const secondFieldBytes = new Uint8Array(32);
    secondFieldBytes.set(attBytes.slice(1, 32), 0); // remaining 31 bytes from attBytes

    const thirdFieldBytes = new Uint8Array(32);
    thirdFieldBytes.set(valueBytes.slice(1, 32), 0); // remaining 31 bytes from value

    console.log('firstFieldBytes', firstFieldBytes);
    console.log('secondFieldBytes', secondFieldBytes);
    console.log('thirdFieldBytes', thirdFieldBytes);

    const firstField = Field.fromBytes(Array.from(firstFieldBytes));
    const secondField = Field.fromBytes(Array.from(secondFieldBytes));
    const thirdField = Field.fromBytes(Array.from(thirdFieldBytes));

    console.log('firstField', firstField.toBigInt().toString());
    console.log('secondField', secondField.toBigInt().toString());
    console.log('thirdField', thirdField.toBigInt().toString());

    return Poseidon.hash([firstField, secondField, thirdField]);
}

// Build leaf hashes from pairs of (Address, FixedBytes32)
export function buildLeavesNonProvable(
    triples: Array<[Bytes20, Bytes32, Bytes32]>
): Field[] {
    return triples.map(([addr, att, val]) =>
        nonProvableStorageSlotLeafHash(addr, att, val)
    );
}

export class ProvableLeafObject extends Struct({
    address: Bytes20.provable,
    attestation: Bytes32.provable,
    value: Bytes32.provable,
}) {}

export function provableLeafContentsHash(leafContents: ProvableLeafObject) {
    const addressBytes = leafContents.address.bytes; // UInt8[]
    const attBytes = leafContents.attestation.bytes.reverse(); // UInt8[]
    const valueBytes = leafContents.value.bytes; // UInt8[]

    /*Provable.asProver(() => {
        Provable.log('addressBytes', addressBytes);
        Provable.log('attBytes', attBytes);
        Provable.log('valueBytes', valueBytes);
    });*/

    // We want 20 bytes from addrBytes (+ 1 byte from attBytes and 1 byte from valueBytes), remaining 31 bytes from attBytes, remaining 31 bytes from valueBytes

    // firstFieldBytes: 20 bytes from addressBytes + 1 byte from attBytes and 1 byte from valueBytes
    const firstFieldBytes: UInt8[] = [];

    for (let i = 0; i < 20; i++) {
        firstFieldBytes.push(addressBytes[i]);
    }
    firstFieldBytes.push(attBytes[0]);
    firstFieldBytes.push(valueBytes[0]);

    for (let i = 22; i < 32; i++) {
        firstFieldBytes.push(UInt8.zero); // static pad to 32
    }

    // secondFieldBytes: remaining 31 bytes from attBytes (1 to 31)
    const secondFieldBytes: UInt8[] = [];
    for (let i = 1; i < 32; i++) {
        secondFieldBytes.push(attBytes[i]);
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

    Provable.asProver(() => {
        console.log(
            'firstFieldBytes',
            firstFieldBytes.map((byte) => byte.toNumber())
        );
        console.log(
            'secondFieldBytes',
            secondFieldBytes.map((byte) => byte.toNumber())
        );
        console.log(
            'thirdFieldBytes',
            thirdFieldBytes.map((byte) => byte.toNumber())
        );
    });

    // Convert UInt8[] to Bytes (provable bytes)
    const firstBytes = Bytes.from(firstFieldBytes);
    const secondBytes = Bytes.from(secondFieldBytes);
    const thirdBytes = Bytes.from(thirdFieldBytes);

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
    let thirdField = new Field(0);
    /*for (let i = 31; i >= 0; i--) {
        firstField = firstField.mul(256).add(firstBytes.bytes[i].value);
        secondField = secondField.mul(256).add(secondBytes.bytes[i].value);
        thirdField = thirdField.mul(256).add(thirdBytes.bytes[i].value);
    }*/
    /*for (let i = 0; i < 32; i++) {
        firstField = firstField.mul(256).add(firstBytes.bytes[i].value);
        secondField = secondField.mul(256).add(secondBytes.bytes[i].value);
        thirdField = thirdField.mul(256).add(thirdBytes.bytes[i].value);
    }*/
    // Little endian version
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
