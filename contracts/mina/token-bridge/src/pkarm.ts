/**
 * PKARM — Proof Key Authorisation for Recipient Minting (PKCE-style)
 *
 * Short:
 *   PKARM is a scheme where a codeVerifier (Poseidon Field derived from a
 *   secret or deterministic Ethereum signature, split into fields) together
 *   with the hash of the recipient Mina account (`this.sender`, split into fields)
 *   authorises the recipient to mint. Both the codeVerifier and recipient are
 *   required to authorise a minting event.
 *
 * Definitions:
 *   - codeVerifier: Field derived from a depositor-provided secret or ETH signature.
 *   - recipient Mina public key: 32 bytes (`this.sender`).
 *   - hPubK : Field = Poseidon(hash of recipient public key fields)
 *   - codeChallenge : Field = Poseidon(codeVerifier, hPubK) (stored on-chain within the Eth
 *    deposit smart contract deposit's map as the second key in a nested map where the first
 *    key is the depositors eth address)
 *
 * Off-chain (depositor):
 *   1. Produce a deterministic Ethereum signature of a fixed field or user secret.
 *   2. Convert signature/secret into fields and compute codeVerifier = Poseidon(fields).
 *   3. Convert recipient Mina public key into fields and compute hPubK = Poseidon(pubKeyFields).
 *   4. Compute codeChallenge = Poseidon(codeVerifier, hPubK) and use within the deposit lockTokens
 *      function of the Eth smart contract.
 *
 * On-chain Eth (depositor):
 *   1. Invokes the lockTokens function of the Eth smart contract with the codeChallenge as the argument.
 *
 * On-chain Mina (recipient):
 *   1. Recipient supplies codeVerifier as a private witness.
 *   2. Contract derives hPubK from `this.sender` Mina public key.
 *   3. Assert Poseidon(codeVerifier, hPubK) == stored codeChallenge.
 *
 * Security:
 *   - Authorisation requires both knowledge of codeVerifier AND that the caller is the recipient.
 *   - Use domain separation for the signed ETH message or secret.
 */

import { wordToBytes } from '@nori-zk/proof-conversion/min';
import { Bytes, Field, Poseidon, PublicKey, UInt8 } from 'o1js';

/**
 * Converts a Mina public key into a Poseidon hash field.
 *
 * @param recipientPublicKey - Mina public key of the recipient.
 * @returns Field representing the hash of the recipient public key.
 *
 * Conceptually:
 *   The public key is split into fields and combined via Poseidon to produce
 *   a unique field suitable for inclusion in the PKARM codeChallenge.
 */
export function generateRecipientPublicKeyHash(recipientPublicKey: PublicKey) {
    const pubKeyFields = recipientPublicKey.toFields();
    //console.log('recipientPublicKey.toFields().length', pubKeyFields.length); // This is two fields
    //console.log('pubKeyFields', pubKeyFields, 'about to do hash');
    return Poseidon.hash(pubKeyFields);
}

/**
 * Represents a fixed-sise 65-byte array for Ethereum signatures.
 */
export class Bytes65 extends Bytes(65) {
    static get zero() {
        return new this(new Array(32).map(() => new UInt8(0)));
    }
}

/**
 * Converts a depositor-provided Ethereum signature or secret into a codeVerifier field.
 *
 * @param ethSignature - Hex string of ETH signature or depositor secret.
 * @returns Field representing the codeVerifier.
 *
 * Conceptually:
 *   Splits the 65-byte input into fields and hashes via Poseidon to produce
 *   a codeVerifier suitable for PKARM.
 */
export function obtainCodeVerifierFromEthSignature(ethSignature: string) {
    const hex = ethSignature.startsWith('0x')
        ? ethSignature.slice(2)
        : ethSignature;
    if (hex.length !== 130) throw new Error('Expected 65-byte signature');
    const bytes = Bytes65.fromHex(hex);
    const fields = bytes.toFields();
    //console.log('ethSignature.bytes.toFields().length', fields.length); // One field per byte (should optimise this but not sure of performance hit)
    return Poseidon.hash(fields);
}

/**
 * Computes the PKARM codeChallenge for a recipient.
 *
 * @param codeVerifier - Field derived from depositor secret or ETH signature.
 * @param recipientPublicKey - Mina public key of the recipient.
 * @returns Field representing the codeChallenge.
 *
 * Conceptually:
 *   Combines the codeVerifier and recipient public key hash via Poseidon
 *   to produce a challenge that is stored/published off-chain.
 */
export function createCodeChallenge(
    codeVerifier: Field,
    recipientPublicKey: PublicKey
) {
    const hPubK = generateRecipientPublicKeyHash(recipientPublicKey);
    /*Provable.asProver(() => {
        console.log(
            'createCodeChallenge recipientPublicKey',
            recipientPublicKey.toBase58()
        );
        console.log(
            'createCodeChallenge codeVerifier',
            codeVerifier.toBigInt()
        );
        console.log('createCodeChallenge hPubK', hPubK.toBigInt());
    });*/
    return Poseidon.hash([codeVerifier, hPubK]);
}

/**
 * Verifies a recipient's supplied codeVerifier against a stored codeChallenge.
 *
 * @param codeVerifier - Field supplied by the recipient.
 * @param recipientPublicKey - Mina public key of the recipient.
 * @param codeChallenge - Stored codeChallenge to verify against.
 *
 * Conceptually:
 *   Recomputes codeChallenge from recipient-supplied codeVerifier and public key,
 *   asserting equality with the stored challenge.
 */
export function verifyCodeChallenge(
    codeVerifier: Field,
    recipientPublicKey: PublicKey,
    codeChallenge: Field
) {
    const computedChallenge = createCodeChallenge(
        codeVerifier,
        recipientPublicKey
    );

    /*Provable.asProver(() => {
        console.log(
            'verifyCodeChallenge codeVerifier',
            codeVerifier.toBigInt()
        );
        console.log(
            'verifyCodeChallenge recipientPublicKey',
            recipientPublicKey.toBase58()
        );
        console.log(
            'verifyCodeChallenge computedChallenge',
            computedChallenge.toBigInt()
        );
    });*/
    computedChallenge.assertEquals(
        codeChallenge,
        'PKARM codeChallenge verification failed'
    );
}

/**
 * Converts a PKARM codeChallenge Field into a big-endian hex string.
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
        wordToBytes(codeChallenge, 32).reverse()
    );
    const codeChallengeBEHex = `0x${beCodeChallengeBytes.toHex()}`;
    //console.log('codeChallengeBEHex', codeChallengeBEHex);
    return codeChallengeBEHex;
}
