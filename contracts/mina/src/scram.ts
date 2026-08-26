/**
 * SCRAM — Signature Commit-Reveal Authentication Mechanism
 *
 * Short:
 *   SCRAM is a scheme where a Mina signature is Poseidon-hashed into a
 *   commitment (codeChallenge). The codeChallenge is stored on-chain within
 *   the Eth deposit smart contract as the key in the `lockedTokens` map.
 *   Later, the claimant supplies the original
 *   signature, publicKey, and message as private witnesses inside a ZK proof
 *   on the Mina side. The ZK circuit verifies both that the signature is
 *   valid for the claimed (publicKey, message) pair AND that its Poseidon
 *   hash equals the stored codeChallenge — without exposing the signature
 *   publicly.
 *
 * Definitions:
 *   - signature: Mina Signature produced by signing a message with the
 *     signer's private key.
 *   - publicKey: Mina PublicKey corresponding to the signer's private key.
 *   - message: Field[] — the message that was signed.
 *   - codeChallenge : Field = Poseidon(signature.toFields()) — the commitment
 *     stored on the Eth smart contract as the deposit key.
 *
 * Off-chain (committer):
 *   1. Sign a message with the signer's Mina private key.
 *   2. Compute codeChallenge = Poseidon(signature.toFields()).
 *   3. Submit the codeChallenge to the Eth smart contract's lockTokens
 *      function, where it becomes the deposit key in `lockedTokens`.
 *
 * On-chain Mina (ZK verification):
 *   1. Claimant supplies the original signature, publicKey, and message
 *      as private witnesses to the ZK circuit.
 *   2. Circuit verifies signature.verify(publicKey, message), proving key
 *      ownership and message integrity.
 *   3. Circuit computes Poseidon(signature.toFields()) and asserts equality
 *      with the stored codeChallenge.
 *   4. The signature is never exposed publicly — all verification occurs
 *      provably inside the circuit.
 *
 * Security:
 *   - Commitment is binding: only the holder of the original signature can
 *     produce a preimage that hashes to the stored codeChallenge.
 *   - Identity is verified: the signature must be valid for the claimed
 *     publicKey and message, preventing substitution.
 *   - Zero-knowledge: the signature witness is never revealed publicly,
 *     preserving privacy of the commitment preimage.
 *   - Poseidon is collision-resistant in the Mina field, so forging a
 *     different signature with the same hash is computationally infeasible.
 *   - Note: SCRAM does not enforce any constraint on what the message is.
 *     Any domain separation or message binding is the caller's responsibility.
 *
 */

import {
    Poseidon,
    Signature,
    Field,
    type PublicKey,
    Bytes,
    Struct,
    Provable,
} from 'o1js';

import { wordToBytesCanonical } from '@nori-zk/proof-conversion/min';

const SCRAMMessage = Provable.Array(Field, 128);

/**
 * The user-supplied private witness for SCRAM verification.
 *
 * Contains only the inputs that are not computed or derived on-chain:
 *   - signature: the Mina Signature that was committed to.
 *   - message: the Field[128] message that was signed.
 *
 * The codeChallenge is read from on-chain state and the publicKey is
 * derived from `this.sender` — neither is user input.
 */
export class SCRAMWitness extends Struct({
    signature: Signature,
    message: SCRAMMessage,
}) {}

/**
 * Computes the SCRAM codeChallenge (commitment) from a Mina signature.
 *
 * @param signature - Mina Signature to commit to.
 * @returns Field representing the codeChallenge.
 *
 * Conceptually:
 *   The signature is decomposed into fields and hashed via Poseidon to
 *   produce a commitment. This codeChallenge is submitted to the Eth smart
 *   contract's lockTokens function as the deposit key. The original
 *   signature is required to open the commitment later inside a ZK proof
 *   on the Mina side.
 */
export function createCodeChallenge(signature: Signature) {
    return Poseidon.hash(signature.toFields());
}

/**
 * Verifies a SCRAM codeChallenge against a privately witnessed signature.
 *
 * @param challenge - Stored codeChallenge to verify against.
 * @param signature - The Mina Signature supplied as a private witness.
 * @param publicKey - Mina PublicKey of the original signer.
 * @param message - The message Field[] that was signed.
 *
 * Conceptually:
 *   Two independent checks are performed inside the ZK circuit:
 *   1. Signature validity — the signature must verify against the supplied
 *      publicKey and message, proving key ownership and message integrity.
 *   2. Commitment match — the Poseidon hash of the signature must equal the
 *      stored codeChallenge, proving this is the exact signature that was
 *      committed to.
 *   The signature is never exposed publicly.
 */
export function verifyCodeChallenge(
    codeChallenge: Field,
    signature: Signature,
    publicKey: PublicKey,
    message: Field[]
) {
    const signatureHash = Poseidon.hash(signature.toFields());
    signature
        .verify(publicKey, message)
        .assertTrue('SCRAM signature verification failure');
    signatureHash
        .equals(codeChallenge)
        .assertTrue('SCRAM codeChallenge does not equal signature hash');
}

/**
 * Converts a SCRAM codeChallenge Field into a big-endian hex string.
 *
 * @param codeChallenge - The Poseidon Field representing the codeChallenge.
 * @returns A 0x-prefixed hexadecimal string representing the codeChallenge in
 *          big-endian byte order, suitable for off-chain use or contract arguments.
 *
 * Conceptually:
 *   - The codeChallenge Field is first converted into a 32-byte word.
 *   - The bytes are reversed to switch from little-endian (internal representation)
 *     to big-endian.
 *   - The resulting bytes are serialized as a hex string with a 0x prefix.
 */
export function codeChallengeFieldToBEHex(codeChallenge: Field) {
    const beCodeChallengeBytes = Bytes.from(
        wordToBytesCanonical(codeChallenge, 32).reverse()
    );
    const codeChallengeBEHex = `0x${beCodeChallengeBytes.toHex()}`;
    return codeChallengeBEHex;
}
