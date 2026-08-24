import { Field, Poseidon, UInt8 } from 'o1js';
import { Bytes20, Bytes32 } from '../types.js';
import { VerifiedRequest } from '../VerifiedRequestAttestor.js';

export function dummyCodeChallenge(i: number): Bytes32 {
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

export type DummyRequest = {
    target: Bytes20;
    collectionKeysCount: number;
    collectionKeys: [Bytes32, Bytes32];
    value: Bytes32;
};

export function dummyRequest(i: number): DummyRequest {
    const targetArr = new Uint8Array(20);
    new DataView(targetArr.buffer).setUint32(0, i, true);

    const key0Arr = new Uint8Array(32);
    new DataView(key0Arr.buffer).setUint32(0, i, true);

    const key1Arr = new Uint8Array(32);
    new DataView(key1Arr.buffer).setUint32(0, i + 1_000_000, true);

    const valueArr = new Uint8Array(32);
    new DataView(valueArr.buffer).setUint32(0, i, true);

    return {
        target: Bytes20.from(targetArr) as Bytes20,
        collectionKeysCount: i % 3,
        collectionKeys: [Bytes32.from(key0Arr), Bytes32.from(key1Arr)],
        value: Bytes32.from(valueArr),
    };
}

export function toVerifiedRequest(r: DummyRequest): VerifiedRequest {
    return new VerifiedRequest({
        target: r.target,
        collectionKeysCount: UInt8.from(r.collectionKeysCount),
        collectionKeys: r.collectionKeys,
        value: r.value,
    });
}

export function nonProvableRequestLeafHash(
    target: Bytes20,
    collectionKeysCount: number,
    collectionKeys: [Bytes32, Bytes32],
    value: Bytes32
): Field {
    const targetBytes = target.toBytes();
    const key0Bytes = collectionKeys[0].toBytes();
    const key1Bytes = collectionKeys[1].toBytes();
    const valueBytes = value.toBytes();

    const firstFieldBytes = new Uint8Array(32);
    firstFieldBytes.set(targetBytes, 0);
    firstFieldBytes[20] = collectionKeysCount;
    firstFieldBytes[21] = key0Bytes[0];
    firstFieldBytes[22] = key1Bytes[0];
    firstFieldBytes[23] = valueBytes[0];

    const secondFieldBytes = new Uint8Array(32);
    secondFieldBytes.set(key0Bytes.slice(1, 32), 0);

    const thirdFieldBytes = new Uint8Array(32);
    thirdFieldBytes.set(key1Bytes.slice(1, 32), 0);

    const fourthFieldBytes = new Uint8Array(32);
    fourthFieldBytes.set(valueBytes.slice(1, 32), 0);

    const firstField = Field.fromBytes(Array.from(firstFieldBytes));
    const secondField = Field.fromBytes(Array.from(secondFieldBytes));
    const thirdField = Field.fromBytes(Array.from(thirdFieldBytes));
    const fourthField = Field.fromBytes(Array.from(fourthFieldBytes));

    return Poseidon.hash([firstField, secondField, thirdField, fourthField]);
}

export function buildVerifiedRequestLeavesNonProvable(
    requests: DummyRequest[]
): Field[] {
    return requests.map((r) =>
        nonProvableRequestLeafHash(
            r.target,
            r.collectionKeysCount,
            r.collectionKeys,
            r.value
        )
    );
}
