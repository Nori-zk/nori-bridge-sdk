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
  Unconstrained,
} from 'o1js';
import { Add } from './Add.js';
import { test, describe, it, beforeEach, before } from 'node:test';
import assert from 'node:assert';
// import {
//   EcdsaEthereum,
//   // getHashHelper,
//   // parseSignature,
// } from 'mina-attestations/build/src/imported.js';
// import {} from 'mina-attestations/';
// import {
//   ZkPass,
//   ZkPassResponseItem,
//   EcdsaEthereum,
// } from 'mina-attestations/imported';
// import { DynamicBytes, Credential } from 'mina-attestations';
// import { ByteUtils } from 'mina-attestations/dynamic';

const proofsEnabled = true;
class Secp256k1 extends createForeignCurve(Crypto.CurveParams.Secp256k1) {}
class Scalar extends Secp256k1.Scalar {}
class Ecdsa extends createEcdsa(Secp256k1) {}
class Bytes32 extends Bytes(2) {}

describe('Add', () => {
  let deployerAccount: Mina.TestPublicKey,
    deployerKey: PrivateKey,
    senderAccount: Mina.TestPublicKey,
    senderKey: PrivateKey,
    userAccount: Mina.TestPublicKey,
    userKey: PrivateKey,
    zkAppAddress: PublicKey,
    zkAppPrivateKey: PrivateKey,
    zkApp: Add;

  before(async () => {
    if (proofsEnabled) await Add.compile();
  });

  beforeEach(async () => {
    const Local = await Mina.LocalBlockchain({ proofsEnabled });
    Mina.setActiveInstance(Local);
    [deployerAccount, senderAccount, userAccount] = Local.testAccounts;
    deployerKey = deployerAccount.key;
    senderKey = senderAccount.key;
    userKey = userAccount.key;

    zkAppPrivateKey = PrivateKey.random();
    zkAppAddress = zkAppPrivateKey.toPublicKey();
    zkApp = new Add(zkAppAddress);
    // console.log(zkApp.tokenId.toString());
    // const abc = await Add.analyzeMethods({ printSummary: true });
    // console.log(abc['update'].gates);
  });

  async function localDeploy() {
    const txn = await Mina.transaction(deployerAccount, async () => {
      AccountUpdate.fundNewAccount(deployerAccount);
      await zkApp.deploy();
    });
    await txn.prove();
    // console.log(await txn.toPretty());
    // this tx needs .sign(), because `deploy()` adds an account update that requires signature authorization
    await txn.sign([deployerKey, zkAppPrivateKey]).send();
  }

  it('generates and deploys the `Add` smart contract', async () => {
    await localDeploy();
    const num = zkApp.num.get();
    assert.strictEqual(num.toString(), Field(1).toString());
  });

  test('simple test', () => {
    assert.strictEqual(1 + 1, 2);
  });

  // it('correctly updates the num state on the `Add` smart contract', async () => {
  //   await localDeploy();

  //   // let { signature, parityBit } = parseSignature(response.validatorSignature);
  //   // let address = ByteUtils.fromHex(response.validatorAddress);
  //   const maxMessageLength = 2;
  //   const Message = DynamicBytes({ maxLength: maxMessageLength });
  //   let message = Message.fromString('a');
  //   console.time('hash helper constraints');
  //   let ethPrivateKey = Secp256k1.Scalar.random();
  //   let ethPublicKey = Secp256k1.generator.scale(ethPrivateKey);
  //   // let { short: shortCs } = await getHashHelper(
  //   //   maxMessageLength
  //   // ).analyzeMethods();
  //   // console.log(shortCs.summary());
  //   // console.timeEnd('hash helper constraints');
  //   // const message = Bytes32.fromString('t');
  //   let signature = Ecdsa.sign(message.toBytes(), ethPrivateKey.toBigInt());
  //   console.time('compile dependencies');
  //   await EcdsaEthereum.compileDependencies({
  //     maxMessageLength,
  //     proofsEnabled,
  //   });
  //   console.timeEnd('compile dependencies');

  //   console.time('ecdsa create credential');
  //   const EcdsaCredential = await EcdsaEthereum.Credential({
  //     maxMessageLength,
  //   });
  //   console.timeEnd('ecdsa create credential');

  //   console.time('ecdsa compile');
  //   let vk = await EcdsaCredential.compile({ proofsEnabled });
  //   console.timeEnd('ecdsa compile');

  //   console.time('ecdsa prove');
  //   let credential = await EcdsaCredential.create({
  //     owner: userAccount,
  //     publicInput: {
  //       signerAddress: EcdsaEthereum.Address.from(ethPublicKey),
  //     },
  //     privateInput: { message, signature, parityBit },
  //   });
  //   console.timeEnd('ecdsa prove');

  //   let json = Credential.toJSON(credential);
  //   let recovered = await Credential.fromJSON(json);

  //   if (proofsEnabled) await Credential.validate(recovered);

  //   let messageVar = Provable.witness(Message, () => message);
  //   let signatureVar = Provable.witness(
  //     EcdsaEthereum.Signature,
  //     () => signature
  //   );
  //   let addressVar = Provable.witness(EcdsaEthereum.Address, () =>
  //     EcdsaEthereum.Address.from(address)
  //   );
  //   let parityBitVar = Unconstrained.witness(() => parityBit);

  //   // update transaction
  //   const txn = await Mina.transaction(senderAccount, async () => {
  //     await zkApp.update();
  //   });
  //   await txn.prove();
  //   await txn.sign([senderKey]).send();

  //   const updatedNum = zkApp.num.get();
  //   expect(updatedNum).toEqual(Field(3));
  // });
});
