import { DynamicBytes, Credential } from 'mina-attestations';
import { EcdsaEthereum } from 'mina-attestations/imported';
import {
  Crypto,
  PrivateKey,
  EcdsaSignature,
  createForeignCurve,
  createEcdsa,
} from 'o1js';
import { Wallet } from 'ethers/wallet';
import { id } from 'ethers/hash';
import { Signature } from 'ethers/crypto';
// import { ByteUtils } from '../../node_modules/mina-attestations/build/src/util.js';
// not imported ================
const ByteUtils = {
  fromHex(hex: string) {
    if (hex.startsWith('0x')) hex = hex.slice(2);
    let bytes = chunkString(hex, 2).map((byte) => parseInt(byte, 16));
    return new Uint8Array(bytes);
  },
};
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
function assert(
  condition: boolean,
  message?: string | (() => string | undefined)
): asserts condition {
  if (!condition) {
    message = typeof message === 'function' ? message() : message;
    throw Error(message ?? 'Assertion failed');
  }
}
//=================================

//consts
const maxMessageLength = 32;
const proofsEnabled = false;

// wallets
let minaPrivKey = PrivateKey.random();
let minaPubKey = minaPrivKey.toPublicKey();
let signer = new Wallet(id('test'));
console.log('signer address', signer.address);

const Message = DynamicBytes({ maxLength: maxMessageLength });

//create signature
class Secp256k1 extends createForeignCurve(Crypto.CurveParams.Secp256k1) {}
class Ecdsa extends createEcdsa(Secp256k1) {}
let sig = await signer.signMessage('abc');
let ethersSig = Signature.from(sig);
let signature = Ecdsa.fromHex(sig);

console.time('compile dependencies');
await EcdsaEthereum.compileDependencies({
  maxMessageLength,
  proofsEnabled,
});
console.timeEnd('compile dependencies');

console.time('ecdsa create credential');
const EcdsaCredential = await EcdsaEthereum.Credential({ maxMessageLength });
console.timeEnd('ecdsa create credential');

console.time('ecdsa compile');
let vk = await EcdsaCredential.compile({ proofsEnabled });
console.timeEnd('ecdsa compile');

let message = Message.fromString('abc');

console.log('message length', message.length.toString());

console.time('ecdsa constraints (recursive)');
let csRec = (await EcdsaCredential.program.analyzeMethods()).run;
console.log(csRec.summary());
console.timeEnd('ecdsa constraints (recursive)');

console.time('ecdsa prove');
let credential = await EcdsaCredential.create({
  owner: minaPubKey,
  publicInput: {
    signerAddress: EcdsaEthereum.Address.from(
      ByteUtils.fromHex(signer.address)
    ),
  },
  privateInput: {
    message,
    signature,
    parityBit: ethersSig.yParity == 0 ? false : true,
  },
});
console.timeEnd('ecdsa prove');

let json = Credential.toJSON(credential);
let recovered = await Credential.fromJSON(json);

if (proofsEnabled) await Credential.validate(recovered);
