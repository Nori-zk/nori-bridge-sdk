import {
  AccountUpdate,
  Bool,
  PublicKey,
  UInt64,
  VerificationKey,
} from 'o1js';

export interface FungibleTokenAdminBase {
  canMint(au: AccountUpdate): Promise<Bool>;
  canChangeAdmin(admin: PublicKey): Promise<Bool>;
  canPause(): Promise<Bool>;
  canResume(): Promise<Bool>;
  canChangeVerificationKey(vk: VerificationKey): Promise<Bool>;
}

export interface MintableToken {
  mint(recipient: PublicKey, amount: UInt64): Promise<AccountUpdate>;
}

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