import {
  AccountUpdate,
  Bool,
  Cache,
  fetchAccount,
  Field,
  Mina,
  Poseidon,
  PrivateKey,
  PublicKey,
  UInt64,
  UInt8,
  VerificationKey,
} from 'o1js';
import { FungibleToken, FungibleTokenAdmin } from '../index.js';
import assert from 'node:assert';
import { test, describe, before } from 'node:test';
import { EscrowStorage } from '../escrow/EscrowStorage.js';
import { NoriCore } from './NoriCore.js';

const proofsEnabled = false;
let isTokenDeployed = false;
let isTokenInitialised = false;
let isEscrowDeployed = false;

type Keypair = {
  publicKey: PublicKey;
  privateKey: PrivateKey;
};

describe('NoriCore', async () => {
  const fee = 1e8;
  let deployer: Mina.TestPublicKey,
    owner: Mina.TestPublicKey,
    whale: Mina.TestPublicKey,
    colin: Mina.TestPublicKey,
    dave: Mina.TestPublicKey,
    bob: Mina.TestPublicKey,
    jackie: Mina.TestPublicKey;
  let token: FungibleToken;
  let tokenId: Field;
  let noriCoreTokenId: Field;
  // let escrow: TokenEscrow;
  // let adminContract: FungibleTokenAdmin;
  let noriCoreContract: NoriCore;
  let tokenKeypair: Keypair, noriCoreKeypair: Keypair;
  let escrowStorageVk: VerificationKey;
  const mintAmount = new UInt64(2e9);
  const firstWithdrawAmount = new UInt64(5e8);
  const totalAmountLocked = new UInt64(9e8);

  before(async () => {
    let { verificationKey: noriCoreVK } = await NoriCore.compile({
      cache: Cache.FileSystem('./cache'),
    });
    // let { verificationKey: vk } = await TokenEscrow.compile({
    //   cache: Cache.FileSystem('./cache'),
    // });
    // console.log('TokenEscrow VK', vk.hash.toString());
    // escrowVk = vk;
    let { verificationKey: storageVk } = await EscrowStorage.compile({
      cache: Cache.FileSystem('./cache'),
    });
    escrowStorageVk = storageVk;
    console.log('EscrowStorage VK', escrowStorageVk.hash.toString());
    if (proofsEnabled) {
      let { verificationKey: tokenVk } = await FungibleToken.compile({
        cache: Cache.FileSystem('./cache'),
      });
      console.log('Token VK', tokenVk.hash.toString());
      // let { verificationKey: tokenAdminVK } = await FungibleTokenAdmin.compile({
      //   cache: Cache.FileSystem('./cache'),
      // });
      // console.log('TokenAdmin VK', tokenAdminVK.hash.toString());
    }
    const Local = await Mina.LocalBlockchain({
      proofsEnabled,
      // enforceTransactionLimits,
    });
    Mina.setActiveInstance(Local);
    [deployer, owner, whale, colin, bob, dave, jackie] = Local.testAccounts;
    tokenKeypair = PrivateKey.randomKeypair();
    // escrowKeypair = PrivateKey.randomKeypair();
    noriCoreKeypair = PrivateKey.randomKeypair();
    token = new FungibleToken(tokenKeypair.publicKey);
    tokenId = token.deriveTokenId();
    // escrow = new TokenEscrow(escrowKeypair.publicKey, tokenId);
    // adminContract = new FungibleTokenAdmin(adminKeypair.publicKey);
    noriCoreContract = new NoriCore(noriCoreKeypair.publicKey);
    noriCoreTokenId = noriCoreContract.deriveTokenId();
    console.log(`
      deployer ${deployer.toBase58()}
      owner ${owner.toBase58()}
      whale ${whale.toBase58()}
      colin ${colin.toBase58()}
      dave ${dave.toBase58()}
      bob ${bob.toBase58()}
      jackie ${jackie.toBase58()}
      token ${tokenKeypair.publicKey.toBase58()}
      admin ${noriCoreKeypair.publicKey.toBase58()}
      tokenId ${tokenId.toString()}
      noriCore tokenId ${noriCoreTokenId.toString()}
    `);
  });

  async function deployTokenAdminContract() {
    console.log('deploying token & admin contract');
    const txn = await Mina.transaction(
      {
        sender: deployer,
        fee,
      },
      async () => {
        AccountUpdate.fundNewAccount(deployer, 2);
        await noriCoreContract.deploy({
          adminPublicKey: noriCoreKeypair.publicKey,
        });
        await token.deploy({
          symbol: 'abc',
          src: 'https://github.com/MinaFoundation/mina-fungible-token/blob/main/FungibleToken.ts',
          allowUpdates: true,
        });
      }
    );
    await txn.prove();
    txn.sign([
      deployer.key,
      tokenKeypair.privateKey,
      noriCoreKeypair.privateKey,
    ]);
    await txn.send().then((v) => v.wait());
    isTokenDeployed = true;
  }

  // async function deployEscrowContract() {
  //   console.log('deploy escrow contract');
  //   const txn = await Mina.transaction(
  //     {
  //       sender: deployer,
  //       fee,
  //     },
  //     async () => {
  //       AccountUpdate.fundNewAccount(deployer, 1);
  //       await escrow.deploy({
  //         tokenAddress: tokenKeypair.publicKey,
  //         owner,
  //       });
  //       await token.approveAccountUpdate(escrow.self);
  //     }
  //   );
  //   await txn.prove();
  //   txn.sign([deployer.key, escrowKeypair.privateKey]);
  //   await txn.send().then((v) => v.wait());
  //   isEscrowDeployed = true;
  // }

  async function initialiseTokenContract() {
    console.log('initialise token admin');
    const txn = await Mina.transaction(
      {
        sender: deployer,
        fee,
      },
      async () => {
        AccountUpdate.fundNewAccount(deployer, 1);

        await token.initialize(
          noriCoreKeypair.publicKey,
          UInt8.from(9),
          // We can set `startPaused` to `Bool(false)` here, because we are doing an atomic deployment
          // If you are not deploying the admin and token contracts in the same transaction,
          // it is safer to start the tokens paused, and resume them only after verifying that
          // the admin contract has been deployed
          Bool(false)
        );
      }
    );
    await txn.prove();
    txn.sign([
      deployer.key,
      tokenKeypair.privateKey,
      noriCoreKeypair.privateKey,
    ]);
    await txn.send().then((v) => v.wait());
    isTokenInitialised = true;
  }
  async function setupStorage(user: Mina.TestPublicKey) {
    console.log('mint to account');
    const mintTx = await Mina.transaction(
      {
        sender: user,
        fee,
      },
      async () => {
        AccountUpdate.fundNewAccount(user, 1);
        await noriCoreContract.setUpStorage(
          user,
          escrowStorageVk,
          token.address
        );
      }
    );
    await mintTx.prove();
    mintTx.sign([user.key]);
    await mintTx.send().then((v) => v.wait());
  }
  async function mintToAccount(
    mintee: Mina.TestPublicKey,
    amount = mintAmount
  ) {
    console.log('mint to account');
    const mintTx = await Mina.transaction(
      {
        sender: mintee,
        fee,
      },
      async () => {
        AccountUpdate.fundNewAccount(mintee, 1);
        await token.mint(mintee, amount);
      }
    );
    await mintTx.prove();
    mintTx.sign([mintee.key]);
    await mintTx.send().then((v) => v.wait());
  }

  async function transferTokens(
    giver: Mina.TestPublicKey,
    receiver: Mina.TestPublicKey
  ) {
    console.log('transferring tokens');
    const transferTx = await Mina.transaction(
      {
        sender: giver,
        fee,
      },
      async () => {
        AccountUpdate.fundNewAccount(giver, 1);
        await token.transfer(giver, receiver, new UInt64(1e9));
      }
    );
    await transferTx.prove();
    transferTx.sign([giver.key]);
    await transferTx.send().then((v) => v.wait());
  }

  async function conditionalTokenSetUp() {
    console.log('conditionalTokenSetUp');
    if (!isTokenDeployed) await deployTokenAdminContract();
    if (!isTokenInitialised) await initialiseTokenContract();
  }

  // async function conditionalEscrowSetUp() {
  // console.log('conditionalEscrowSetUp');
  // if (!isEscrowDeployed) await deployEscrowContract();
  // }

  test('succesfully mints via NoriCore', async () => {
    await conditionalTokenSetUp();
    // await conditionalEscrowSetUp();
    // const escrowBalanceBefore = (
    //   await token.getBalanceOf(escrow.address)
    // ).toBigInt();

    await setupStorage(jackie);

    let storage = new EscrowStorage(jackie, noriCoreContract.deriveTokenId());
    let userHash = storage.userKeyHash.get();
    assert.equal(
      userHash.toBigInt(),
      Poseidon.hash(jackie.toFields()).toBigInt()
    );
    // const mintedSoFar0 = storage.mintedSoFar.get().toBigInt();
    // console.log('mintedSoFar setup', mintedSoFar0);

    await mintToAccount(jackie);
    // await depositToEscrow(owner);

    const jackieBalanceAfterFirstMint = (
      await token.getBalanceOf(jackie)
    ).toBigInt();
    // const escrowBalanceBeforeWithdraw = (
    //   await token.getBalanceOf(escrow.address)
    // ).toBigInt();
    console.log('jackieBalance after first mint', jackieBalanceAfterFirstMint);
    // console.log('escrowBalanceBeforeWithdraw', escrowBalanceBeforeWithdraw);

    // assert.equal(
    //   escrowBalanceBeforeWithdraw,
    //   depositAmount.toBigInt(),
    //   'deposit amount incorrect'
    // );
    assert.equal(
      jackieBalanceAfterFirstMint,
      mintAmount.toBigInt(),
      'jackie fresh mint balance incorrect'
    );
  });
});
