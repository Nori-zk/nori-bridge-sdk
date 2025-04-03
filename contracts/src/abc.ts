import {
  AccountUpdate,
  createForeignCurve,
  Field,
  Mina,
  PrivateKey,
  PublicKey,
  Crypto,
  createEcdsa,
  Bytes,
  Provable,
  UInt8,
  Unconstrained,
  ZkProgram,
  Keccak,
} from 'o1js';
import {
  ZkPass,
  ZkPassResponseItem,
  EcdsaEthereum,
} from 'mina-attestations/imported';
import { DynamicBytes, Credential, DynamicArray } from 'mina-attestations';
// import { DynamicArray, } from 'mina-attestations/dynamic';
// import {
//   getHashHelper,
//   parseSignature,
// } from '../node_modules/mina-attestations/src/imported/ecdsa-credential.js';

// import { ByteUtils } from '../node_modules/mina-attestations/build/src/util.js';

import { Wallet } from 'ethers/wallet';
import { id } from 'ethers/hash';
import { DynamicSHA3 } from 'mina-attestations/dynamic';

const MESSAGE_PREFIX = '\x19Ethereum Signed Message:\n32';
const MessageHash = Bytes(32);
let proofsEnabled = true;
let maxMessageLength = 32;
let minaPrivKey = PrivateKey.random();
let minaPubKey = minaPrivKey.toPublicKey();
class Secp256k1 extends createForeignCurve(Crypto.CurveParams.Secp256k1) {}
// class Scalar extends Secp256k1.Scalar {}
class Ecdsa extends createEcdsa(Secp256k1) {}
class Bytes32 extends Bytes(32) {}
let signer = new Wallet(id('test'));
// let ethMessage = 'a';
// Signing the message
// let { signature, parityBit } = parseSignature(sig);
// let address = fromHex(signer.address);
const Message = DynamicArray(UInt8, { maxLength: maxMessageLength });
// const Message = DynamicBytes({ maxLength: maxMessageLength });
// let message = Message.fromString('a');
// const publicKeyE = Secp256k1.fromEthers(signer.address.slice(2));
const msgBytes = Bytes32.fromString('a');

let sig = await signer.signMessage('a');
console.log('signature', sig);
// const signatureE = Ecdsa.fromHex(rawSignature);
let message = ZkPass.encodeParameters(['bytes32'], [msgBytes.toBytes()]);
console.log('message length', message.length);

// let ethPrivateKey = Secp256k1.Scalar.random();
// let ethPublicKey = Secp256k1.generator.scale(ethPrivateKey);
// let signature = Ecdsa.sign(message.toBytes(), ethPrivateKey.toBigInt());
// let signature = Ecdsa.sign(message.toBytes(), signer.privateKey);
let { signature, parityBit } = parseSignature(sig);
// let signature = Ecdsa.fromHex(sig);
// signature.
console.time('hash helper constraints');
let { short: shortCs } = await createHashHelper(
  maxMessageLength
).analyzeMethods();
console.log(shortCs.summary());
// console.timeEnd('hash helper constraints');

console.time('compile dependencies');
await EcdsaEthereum.compileDependencies({
  maxMessageLength,
  proofsEnabled,
});
console.timeEnd('compile dependencies');

console.time('ecdsa create credential');
const EcdsaCredential = await EcdsaEthereum.Credential({
  maxMessageLength,
});
console.timeEnd('ecdsa create credential');

console.time('ecdsa compile');
let vk = await EcdsaCredential.compile({ proofsEnabled });
console.timeEnd('ecdsa compile');

console.time('ecdsa prove');
let credential = await EcdsaCredential.create({
  owner: minaPubKey,
  publicInput: {
    // signerAddress: EcdsaEthereum.Address.from(ethPublicKey),
    signerAddress: EcdsaEthereum.Address.from(fromHex(signer.address)),
    // signerAddress: EcdsaEthereum.Address.fromHex(signer.address),
  },
  privateInput: { message, signature, parityBit },
});
console.timeEnd('ecdsa prove');

let json = Credential.toJSON(credential);
let recovered = await Credential.fromJSON(json);

if (proofsEnabled) await Credential.validate(recovered);

// let messageVar = Provable.witness(Message, () => message);
// let signatureVar = Provable.witness(EcdsaEthereum.Signature, () => signature);
// let addressVar = Provable.witness(EcdsaEthereum.Address, () =>
//   EcdsaEthereum.Address.from(address)
// );
// let parityBitVar = Unconstrained.witness(() => parityBit);

function assert(
  condition: boolean,
  message?: string | (() => string | undefined)
): asserts condition {
  if (!condition) {
    message = typeof message === 'function' ? message() : message;
    throw Error(message ?? 'Assertion failed');
  }
}
function chunk<T>(array: T[], size: number): T[][] {
  assert(
    array.length % size === 0,
    `${array.length} is not a multiple of ${size}`
  );
  return Array.from({ length: array.length / size }, (_, i) =>
    array.slice(size * i, size * (i + 1))
  );
}
function chunkString(str: string, size: number): string[] {
  return chunk([...str], size).map((chunk) => chunk.join(''));
}
function fromHex(hex: string) {
  if (hex.startsWith('0x')) hex = hex.slice(2);
  let bytes = chunkString(hex, 2).map((byte) => parseInt(byte, 16));
  return new Uint8Array(bytes);
}
function parseSignature(signature: string | Uint8Array) {
  if (typeof signature === 'string') signature = fromHex(signature);
  assert(signature.length === 65);

  let r = bytesToBigintBE(signature.slice(0, 32));
  let s = bytesToBigintBE(signature.slice(32, 64));
  let v = signature[64]!;
  assert(v === 27 || v === 28, `Invalid recovery id "v" ${v}`);

  // Convert v to parity of R_y (27/28 -> 0/1 -> boolean)
  let parityBit = !!(v - 27);
  return { signature: { r, s }, parityBit };
}
function bytesToBigintBE(bytes: Uint8Array | number[]) {
  return bytesToBigint(bytes.reverse());
}

function bytesToBigint(bytes: Uint8Array | number[]) {
  let x = 0n;
  let bitPosition = 0n;
  for (let byte of bytes) {
    x += BigInt(byte) << bitPosition;
    bitPosition += 8n;
  }
  return x;
}
function createHashHelper(maxMessageLength: number) {
  const Message = DynamicArray(UInt8, { maxLength: maxMessageLength });

  let hashHelperProgram = ZkProgram({
    name: 'ecdsa-hash-helper',
    publicInput: Message,
    publicOutput: MessageHash,

    methods: {
      short: {
        privateInputs: [],
        async method(message: DynamicBytes) {
          let intermediateHash = DynamicSHA3.keccak256(message);
          let messageHash = Keccak.ethereum([
            ...Bytes.fromString(MESSAGE_PREFIX).bytes,
            ...intermediateHash.bytes,
          ]);
          return { publicOutput: messageHash };
        },
      },
      // TODO: implement version 2 / "long" method
    },
  });

  return hashHelperProgram;
}
