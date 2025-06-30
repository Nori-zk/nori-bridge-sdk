/**
 * This example shows how to turn an ethers.js signature into an ECDSA credential.
 */
import { Credential, DynamicBytes } from 'mina-attestations';
import { EcdsaEthereum } from 'mina-attestations/imported';
import { PrivateKey, Bytes } from 'o1js';
import { Wallet } from 'ethers/wallet';
import { id } from 'ethers/hash';

// consts
const maxMessageLength = 16;
const proofsEnabled = true;
const Message = DynamicBytes({ maxLength: maxMessageLength });

// prepare ecdsa credential
await EcdsaEthereum.compileDependencies({ maxMessageLength, proofsEnabled });
const EcdsaCredential = await EcdsaEthereum.Credential({ maxMessageLength });
await EcdsaCredential.compile({ proofsEnabled });

// wallets
let { publicKey: minaPubKey } = PrivateKey.randomKeypair();
let signer = new Wallet(id('test'));

// signature
let message = 'Created for Nori';
const parseHex = (hex: string) => Bytes.fromHex(hex.slice(2)).toBytes();
const hashMessage = (msg: string) => parseHex(id(msg));
let sig = await signer.signMessage(hashMessage(message));

// create credential (which verifies the signature)
let { signature, parityBit } = EcdsaEthereum.parseSignature(sig);

let credential = await EcdsaCredential.create({
  owner: minaPubKey,
  publicInput: { signerAddress: EcdsaEthereum.parseAddress(signer.address) },
  privateInput: { message: Message.fromString(message), signature, parityBit },
});
console.log(
  '✅ created credential',
  Credential.toJSON(credential).slice(0, 1000) + '...'
);

console.log(
  'credential message:',
  credential.credential.data.message.toString()
);
console.log(
  'credential signer',
  credential.witness.proof.publicInput.signerAddress.toHex()
);
console.log('credential owner:', credential.credential.owner.toBase58());

// import { DynamicBytes, Credential } from 'mina-attestations';
// import { EcdsaEthereum } from 'mina-attestations/imported';
// import {
//   Crypto,
//   PrivateKey,
//   EcdsaSignature,
//   createForeignCurve,
//   createEcdsa,
// } from 'o1js';
// // import { toUtf8Bytes } from 'ethers/utils';
// // import { Wallet } from 'ethers/wallet';
// // import { id } from 'ethers/hash';
// // import { Signature, keccak256 } from 'ethers/crypto';
// import { Wallet, utils, Signature } from 'ethers';
// // import { ByteUtils } from '../../node_modules/mina-attestations/build/src/util.js';
// // not imported ================
// const ByteUtils = {
//   fromHex(hex: string) {
//     if (hex.startsWith('0x')) hex = hex.slice(2);
//     let bytes = chunkString(hex, 2).map((byte) => parseInt(byte, 16));
//     return new Uint8Array(bytes);
//   },
// };
// function chunk<T>(array: T[], size: number): T[][] {
//   assert(
//     array.length % size === 0,
//     `${array.length} is not a multiple of ${size}`
//   );
//   return Array.from({ length: array.length / size }, (_, i) =>
//     array.slice(size * i, size * (i + 1))
//   );
// }

// function chunkString(str: string, size: number): string[] {
//   return chunk([...str], size).map((chunk) => chunk.join(''));
// }
// function assert(
//   condition: boolean,
//   message?: string | (() => string | undefined)
// ): asserts condition {
//   if (!condition) {
//     message = typeof message === 'function' ? message() : message;
//     throw Error(message ?? 'Assertion failed');
//   }
// }
// //=================================

// //consts
// const maxMessageLength = 32;
// const proofsEnabled = false;

// // wallets
// let minaPrivKey = PrivateKey.random();
// let minaPubKey = minaPrivKey.toPublicKey();
// let signer = Wallet.createRandom();
// console.log('signer address', signer.address);

// //create signature
// // class Secp256k1 extends createForeignCurve(Crypto.CurveParams.Secp256k1) {}
// // class Ecdsa extends createEcdsa(Secp256k1) {}

// // let sig = await signer.signMessage('abc');
// // let ethersSig = Signature.from(sig);
// // let signature = Ecdsa.fromHex(sig);

// const raw = utils.toUtf8Bytes('abc');
// const digest = utils.keccak256(raw);
// const sigFrag = signer._signingKey().signDigest(digest);
// const signatureHex = utils.joinSignature(sigFrag);
// // const signatureHex = sigFrag.compact;
// const parityBit = sigFrag.recoveryParam === 1;

// // const sigFrag = signer.signingKey.sign(digest);

// console.time('compile dependencies');
// await EcdsaEthereum.compileDependencies({
//   maxMessageLength,
//   proofsEnabled,
// });
// console.timeEnd('compile dependencies');

// console.time('ecdsa create credential');
// const EcdsaCredential = await EcdsaEthereum.Credential({ maxMessageLength });
// console.timeEnd('ecdsa create credential');

// console.time('ecdsa compile');
// let vk = await EcdsaCredential.compile({ proofsEnabled });
// console.timeEnd('ecdsa compile');

// // let message = Message.fromString('abc');

// // console.log('message length', message.length.toString());

// console.time('ecdsa constraints (recursive)');
// let csRec = (await EcdsaCredential.program.analyzeMethods()).run;
// console.log(csRec.summary());
// console.timeEnd('ecdsa constraints (recursive)');

// console.time('ecdsa prove');

// // Build the publicInput / privateInput
// const Message = DynamicBytes({ maxLength: maxMessageLength });
// const messageVar = Message.fromBytes(raw);

// console.log('message length', messageVar.length.toString());
// const signatureVar = EcdsaEthereum.Signature.fromHex(signatureHex);
// const addressBytes = EcdsaEthereum.Address.from(
//   utils.arrayify(signer.address) // 20-byte Uint8Array
// );
// let credential = await EcdsaCredential.create({
//   owner: minaPubKey,
//   publicInput: { signerAddress: addressBytes },
//   // publicInput: {
//   //   signerAddress: EcdsaEthereum.Address.from(
//   //     ByteUtils.fromHex(signer.address)
//   //   ),
//   // },
//   privateInput: {
//     message: messageVar,
//     signature: signatureVar,
//     parityBit, // boolean from above
//   },
// });
// console.timeEnd('ecdsa prove');

// let json = Credential.toJSON(credential);
// let recovered = await Credential.fromJSON(json);

// if (proofsEnabled) await Credential.validate(recovered);
