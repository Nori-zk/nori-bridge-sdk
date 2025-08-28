import { DynamicString } from 'mina-attestations';
import { Bytes, Field } from 'o1js';
import { wordToBytes } from '@nori-zk/proof-conversion/min';

// Secret type utils

type CharArray<S extends string> = S extends `${infer First}${infer Rest}`
    ? [First, ...CharArray<Rest>]
    : [];

type CountChars<S extends string> = CharArray<S>['length'];

type ArrayOfLength<
    Length extends number,
    Collected extends unknown[] = []
> = Collected['length'] extends Length
    ? Collected
    : ArrayOfLength<Length, [unknown, ...Collected]>;

type IsAtMost<
    S extends string,
    Max extends number
> = ArrayOfLength<Max> extends [...ArrayOfLength<CountChars<S>>, ...unknown[]]
    ? true
    : false;

type LengthMismatchError<Expected extends number> = {
    expectedLength: Expected;
};

// String length enforcement types.

// Fixed length string enforcement type.
export type EnforceLength<
    S extends string,
    N extends number
> = CountChars<S> extends N ? S : LengthMismatchError<N>;

// Max length string enforcement type.
export type EnforceMaxLength<S extends string, Max extends number> = IsAtMost<
    S,
    Max
> extends true
    ? S
    : LengthMismatchError<Max>;

// Define the max secret length that we can support.
export const secretMaxLength = 20 as const;
export type SecretMaxLength = typeof secretMaxLength;

// Define secret string type
export const SecretString = DynamicString({ maxLength: secretMaxLength });

export function getSecretHashFromPresentationJson(presentationJsonStr: string) {
    const presentation = JSON.parse(presentationJsonStr);
    const messageHashString = presentation.outputClaim.value.messageHash.value;
    const messageHashBigInt = BigInt(messageHashString);
    const credentialAttestationHashField = Field.from(messageHashBigInt);
    const beAttestationHashBytes = Bytes.from(
        wordToBytes(credentialAttestationHashField, 32).reverse()
    );
    const credentialAttestationBEHex = `0x${beAttestationHashBytes.toHex()}`;
    return {
        credentialAttestationBEHex,
        credentialAttestationHashField,
        credentialAttestationBigInt: messageHashBigInt,
    };
}
