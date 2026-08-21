import { Bytes, Field, Poseidon, Struct, UInt8 } from 'o1js';
import { Bytes20, Bytes32 } from '../types.js';
import { VerifiedRequest } from '../ContractDepositAttestor.js';

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

/**
 * @deprecated Superseded by {@link nonProvableRequestLeafHash}.
 */
export function nonProvableStorageSlotLeafHash(
    codeChallenge: Bytes32,
    value: Bytes32
): Field {
    const codeChallengeBytes = codeChallenge.toBytes();
    const valueBytes = value.toBytes();

    // 64 bytes total (32 + 32), max 31 bytes per field -> 3 fields
    // firstFieldBytes: 1 byte from codeChallenge + 1 byte from value + 30 zeros
    const firstFieldBytes = new Uint8Array(32);
    firstFieldBytes[0] = codeChallengeBytes[0];
    firstFieldBytes[1] = valueBytes[0];

    // secondFieldBytes: remaining 31 bytes from codeChallenge (1 to 31)
    const secondFieldBytes = new Uint8Array(32);
    secondFieldBytes.set(codeChallengeBytes.slice(1, 32), 0);

    // thirdFieldBytes: remaining 31 bytes from value (1 to 31)
    const thirdFieldBytes = new Uint8Array(32);
    thirdFieldBytes.set(valueBytes.slice(1, 32), 0);

    /*console.log('firstFieldBytes', firstFieldBytes);
    console.log('secondFieldBytes', secondFieldBytes);
    console.log('thirdFieldBytes', thirdFieldBytes);*/

    const firstField = Field.fromBytes(Array.from(firstFieldBytes));
    const secondField = Field.fromBytes(Array.from(secondFieldBytes));
    const thirdField = Field.fromBytes(Array.from(thirdFieldBytes));

    /*console.log('firstField', firstField.toBigInt().toString());
    console.log('secondField', secondField.toBigInt().toString());
    console.log('thirdField', thirdField.toBigInt().toString());*/

    return Poseidon.hash([firstField, secondField, thirdField]);
}

// Build leaf hashes from pairs of (CodeChallenge, Value)
export function buildLeavesNonProvable(
    pairs: Array<[Bytes32, Bytes32]>
): Field[] {
    return pairs.map(([codeChallenge, val]) =>
        nonProvableStorageSlotLeafHash(codeChallenge, val)
    );
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

/**
 * @deprecated Superseded by {@link VerifiedRequest}.
 */
export class ProvableLeafObject extends Struct({
    codeChallenge: Bytes32.provable,
    value: Bytes32.provable,
}) {}

/**
 * @deprecated Superseded by {@link provableRequestLeafHash}.
 */
export function provableLeafContentsHash(leafContents: ProvableLeafObject) {
    const codeChallengeBytes = leafContents.codeChallenge.bytes; // UInt8[]
    const valueBytes = leafContents.value.bytes; // UInt8[]

    /*Provable.asProver(() => {
        Provable.log('codeChallengeBytes', codeChallengeBytes);
        Provable.log('valueBytes', valueBytes);
    });*/

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

    // Extract the first field (there should only ever be one here)
    /*Provable.asProver(() => {
        Provable.log('firstBytes.toFields()', firstBytes.toFields());
        Provable.log('secondBytes.toFields()', secondBytes.toFields());
        Provable.log('thirdBytes.toFields()', thirdBytes.toFields());
    });*/

    let firstField = new Field(0);
    let secondField = new Field(0);
    let thirdField = new Field(0);

    // Little endian
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
