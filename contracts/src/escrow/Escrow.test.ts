import {
  AccountUpdate,
  Bool,
  Cache,
  fetchAccount,
  Field,
  Mina,
  PrivateKey,
  PublicKey,
  UInt64,
  UInt8,
  VerificationKey,
} from 'o1js';
import { FungibleToken, FungibleTokenAdmin } from '../index.js';
import { TokenEscrow } from './Escrow.js';
import assert from 'node:assert';
import { test, describe, before } from 'node:test';
import { EscrowStorage } from './EscrowStorage.js';

const proofsEnabled = true;
let isTokenDeployed = false;
let isTokenInitialised = false;
let isEscrowDeployed = false;

type Keypair = {
  publicKey: PublicKey;
  privateKey: PrivateKey;
};

describe('Escrow', async () => {
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
  let escrow: TokenEscrow;
  let adminContract: FungibleTokenAdmin;
  let tokenKeypair: Keypair, escrowKeypair: Keypair, adminKeypair: Keypair;
  let escrowStorageVk: VerificationKey;
  const depositAmount = new UInt64(2e9);
  const firstWithdrawAmount = new UInt64(5e8);
  const totalAmountLocked = new UInt64(9e8);

  before(async () => {
    let { verificationKey: vk } = await TokenEscrow.compile({
      cache: Cache.FileSystem('./cache'),
    });
    console.log('TokenEscrow VK', vk.hash.toString());
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
      let { verificationKey: tokenAdminVK } = await FungibleTokenAdmin.compile({
        cache: Cache.FileSystem('./cache'),
      });
      console.log('TokenAdmin VK', tokenAdminVK.hash.toString());
    }
    const Local = await Mina.LocalBlockchain({
      proofsEnabled,
      // enforceTransactionLimits,
    });
    Mina.setActiveInstance(Local);
    [deployer, owner, whale, colin, bob, dave, jackie] = Local.testAccounts;
    tokenKeypair = PrivateKey.randomKeypair();
    escrowKeypair = PrivateKey.randomKeypair();
    adminKeypair = PrivateKey.randomKeypair();
    token = new FungibleToken(tokenKeypair.publicKey);
    tokenId = token.deriveTokenId();
    escrow = new TokenEscrow(escrowKeypair.publicKey, tokenId);
    adminContract = new FungibleTokenAdmin(adminKeypair.publicKey);
    console.log(`
      deployer ${deployer.toBase58()}
      owner ${owner.toBase58()}
      whale ${whale.toBase58()}
      colin ${colin.toBase58()}
      dave ${dave.toBase58()}
      bob ${bob.toBase58()}
      jackie ${jackie.toBase58()}
      token ${tokenKeypair.publicKey.toBase58()}
      escrow ${escrowKeypair.publicKey.toBase58()}
      admin ${adminKeypair.publicKey.toBase58()}
      tokenId ${tokenId.toString()}
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
        await adminContract.deploy({ adminPublicKey: adminKeypair.publicKey });
        await token.deploy({
          symbol: 'abc',
          src: 'https://github.com/MinaFoundation/mina-fungible-token/blob/main/FungibleToken.ts',
          allowUpdates: true,
        });
      }
    );
    await txn.prove();
    txn.sign([deployer.key, tokenKeypair.privateKey, adminKeypair.privateKey]);
    await txn.send().then((v) => v.wait());
    isTokenDeployed = true;
  }

  async function deployEscrowContract() {
    console.log('deploy escrow contract');
    const txn = await Mina.transaction(
      {
        sender: deployer,
        fee,
      },
      async () => {
        AccountUpdate.fundNewAccount(deployer, 1);
        await escrow.deploy({
          tokenAddress: tokenKeypair.publicKey,
          owner,
        });
        await token.approveAccountUpdate(escrow.self);
      }
    );
    await txn.prove();
    txn.sign([deployer.key, escrowKeypair.privateKey]);
    await txn.send().then((v) => v.wait());
    isEscrowDeployed = true;
  }

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
          adminKeypair.publicKey,
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
    txn.sign([deployer.key, tokenKeypair.privateKey, adminKeypair.privateKey]);
    await txn.send().then((v) => v.wait());
    isTokenInitialised = true;
  }

  async function mintToAccount(mintee: Mina.TestPublicKey) {
    console.log('mint to account');
    const mintTx = await Mina.transaction(
      {
        sender: owner,
        fee,
      },
      async () => {
        AccountUpdate.fundNewAccount(owner, 1);
        await token.mint(mintee, new UInt64(2e9));
      }
    );
    await mintTx.prove();
    mintTx.sign([owner.key, adminKeypair.privateKey]); // play around with making admin key not needed
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

  async function depositToEscrow(depositer: Mina.TestPublicKey) {
    const txn = await Mina.transaction(
      {
        sender: depositer,
        fee,
      },
      async () => {
        await escrow.deposit(depositAmount);
        await token.approveAccountUpdate(escrow.self);
      }
    );
    await txn.prove();
    txn.sign([depositer.key]);
    await txn.send().then((v) => v.wait());
  }

  async function firstWithdrawFromEscrow(withdrawTo: Mina.TestPublicKey) {
    console.log('----firstWithdraw from escrow----');
    const txn = await Mina.transaction(
      {
        sender: withdrawTo,
        fee,
      },
      async () => {
        AccountUpdate.fundNewAccount(withdrawTo, 1);
        await escrow.firstWithdraw(
          withdrawTo,
          firstWithdrawAmount,
          escrowStorageVk
        );
        await token.approveAccountUpdate(escrow.self);
      }
    );
    // console.log(txn.toPretty());
    await txn.prove();
    txn.sign([withdrawTo.key]);
    await txn.send().then((v) => v.wait());
    // console.log('Withdraw tx result:', withdrawTxResult.toPretty());
    // assert.equal(withdrawTxResult.status, 'included');
  }

  async function withdrawFromEscrow(withdrawTo: Mina.TestPublicKey) {
    console.log('----withdraw from escrow----');
    const txn = await Mina.transaction(
      {
        sender: withdrawTo,
        fee,
      },
      async () => {
        // AccountUpdate.fundNewAccount(withdrawTo, 1);
        await escrow.withdraw(withdrawTo, totalAmountLocked);
        await token.approveAccountUpdate(escrow.self);
      }
    );
    // console.log(txn.toPretty());
    await txn.prove();
    txn.sign([withdrawTo.key]);
    await txn.send().then((v) => v.wait());
    // console.log('Withdraw tx result:', withdrawTxResult.toPretty());
    // assert.equal(withdrawTxResult.status, 'included');
  }

  async function conditionalTokenSetUp() {
    console.log('conditionalTokenSetUp');
    if (!isTokenDeployed) await deployTokenAdminContract();
    if (!isTokenInitialised) await initialiseTokenContract();
  }

  async function conditionalEscrowSetUp() {
    console.log('conditionalEscrowSetUp');
    if (!isEscrowDeployed) await deployEscrowContract();
  }

  test('initialise token contract test', async () => {
    await conditionalTokenSetUp();
    const tokenAdminKey = await token.admin.fetch();
    const tokenDecimal = await token.decimals.fetch();
    assert.equal(tokenAdminKey.toBase58(), adminKeypair.publicKey.toBase58());
    assert.equal(tokenDecimal, 9);
  });

  test('mint to account', async () => {
    const daveBalanceBeforeMint = (await token.getBalanceOf(dave)).toBigInt();
    assert.equal(daveBalanceBeforeMint, 0n);
    await conditionalTokenSetUp();
    await mintToAccount(dave);
    const daveBalanceAfterMint = (await token.getBalanceOf(dave)).toBigInt();
    assert.equal(daveBalanceAfterMint, BigInt(2e9));
  });

  test('transfer from dave account to colin', async () => {
    const colinBalanceBeforeMint = (await token.getBalanceOf(colin)).toBigInt();
    const daveBalanceBeforeMint = (await token.getBalanceOf(dave)).toBigInt();
    assert.equal(colinBalanceBeforeMint, 0n);
    await conditionalTokenSetUp();
    if (daveBalanceBeforeMint == 0n) await mintToAccount(dave);
    const daveBalanceAfterMint = (await token.getBalanceOf(dave)).toBigInt();
    assert.equal(daveBalanceAfterMint, BigInt(2e9));
    await transferTokens(dave, colin);
    const colinBalanceAfterTransfer = (
      await token.getBalanceOf(colin)
    ).toBigInt();
    const daveBalanceAfterTransfer = (
      await token.getBalanceOf(dave)
    ).toBigInt();
    assert.equal(colinBalanceAfterTransfer, BigInt(1e9));
    assert.equal(daveBalanceAfterTransfer, BigInt(1e9));
  });

  test('deploy escrow contract', async () => {
    await conditionalTokenSetUp();
    await conditionalEscrowSetUp();
    const escrowTokenAddress = await escrow.tokenAddress.fetch();
    assert.equal(
      escrowTokenAddress.toBase58(),
      tokenKeypair.publicKey.toBase58()
    );
  });

  test('fail to deposit to escrow as not admin', async () => {
    await conditionalTokenSetUp();
    await conditionalEscrowSetUp();
    const bobBalanceBeforeDeposit = (await token.getBalanceOf(bob)).toBigInt();
    const escrowBalanceBeforeDeposit = (
      await token.getBalanceOf(escrow.address)
    ).toBigInt();
    assert.equal(escrowBalanceBeforeDeposit, 0n);
    if (bobBalanceBeforeDeposit == 0n) await mintToAccount(bob);
    const bobBalanceAfterMint = (await token.getBalanceOf(bob)).toBigInt();
    assert.equal(bobBalanceAfterMint, BigInt(2e9));
    await assert.rejects(() => depositToEscrow(bob));
  });

  test('deposit to escrow', async () => {
    await conditionalTokenSetUp();
    await conditionalEscrowSetUp();
    const ownerBalanceBeforeDeposit = (
      await token.getBalanceOf(owner)
    ).toBigInt();
    const escrowBalanceBeforeDeposit = (
      await token.getBalanceOf(escrow.address)
    ).toBigInt();
    assert.equal(escrowBalanceBeforeDeposit, 0n);
    if (ownerBalanceBeforeDeposit == 0n) await mintToAccount(owner);
    const ownerBalanceAfterMint = (await token.getBalanceOf(owner)).toBigInt();
    assert.equal(ownerBalanceAfterMint, BigInt(2e9));
    await depositToEscrow(owner);
    const escrowBalanceAfterDeposit = (
      await token.getBalanceOf(escrow.address)
    ).toBigInt();
    assert.equal(escrowBalanceAfterDeposit, BigInt(2e9));
    const ownerBalanceAfterDeposit = (
      await token.getBalanceOf(owner)
    ).toBigInt();
    assert.equal(ownerBalanceAfterDeposit, 0n);
  });

  test.only('withdraw from escrow', async () => {
    await conditionalTokenSetUp();
    await conditionalEscrowSetUp();
    const escrowBalanceBefore = (
      await token.getBalanceOf(escrow.address)
    ).toBigInt();

    if (escrowBalanceBefore == 0n) {
      await mintToAccount(owner);
      await depositToEscrow(owner);
    }
    const jackieBalanceBeforeWithdraw = (
      await token.getBalanceOf(jackie)
    ).toBigInt();
    const escrowBalanceBeforeWithdraw = (
      await token.getBalanceOf(escrow.address)
    ).toBigInt();
    console.log('jackieBalanceBeforeWithdraw', jackieBalanceBeforeWithdraw);
    console.log('escrowBalanceBeforeWithdraw', escrowBalanceBeforeWithdraw);

    assert.equal(
      escrowBalanceBeforeWithdraw,
      depositAmount.toBigInt(),
      'deposit amount incorrect'
    );
    assert.equal(
      jackieBalanceBeforeWithdraw,
      0n,
      'jackie initial balance incorrect'
    );

    await firstWithdrawFromEscrow(jackie);
    const jackieBalanceAfterWithdraw = (
      await token.getBalanceOf(jackie)
    ).toBigInt();
    const escrowBalanceAfterWithdraw = (
      await token.getBalanceOf(escrow.address)
    ).toBigInt();

    console.log('jackieBalanceAfterWithdraw', jackieBalanceAfterWithdraw);
    console.log('escrowBalanceAfterWithdraw', escrowBalanceAfterWithdraw);

    assert.equal(
      jackieBalanceAfterWithdraw,
      firstWithdrawAmount.toBigInt(),
      'jackie balance after first withdrawal incorrect'
    );
    assert.equal(
      escrowBalanceAfterWithdraw,
      depositAmount.sub(firstWithdrawAmount).toBigInt(),
      'escrow balance after first withdrawal incorrect'
    );

    // console.log('jackie', jackie.toBase58());
    // console.log('tokenId', token.deriveTokenId().toString());

    let storage = new EscrowStorage(jackie, token.deriveTokenId());
    const mintedSoFar1 = storage.mintedSoFar.get().toBigint(); // TODO tell them bove bigInt
    console.log('mintedSoFar after first withdrawal', mintedSoFar1);

    assert.equal(
      mintedSoFar1,
      firstWithdrawAmount.toBigInt(),
      'minted so far incorrect'
    );
    assert.equal(jackieBalanceAfterWithdraw, mintedSoFar1, 'balances mismatch');

    await withdrawFromEscrow(jackie);

    const jackieEndBalance = (await token.getBalanceOf(jackie)).toBigInt();
    const mintedSoFar2 = storage.mintedSoFar.get().toBigint();
    const escrowBalanceAfter2Withdraw = (
      await token.getBalanceOf(escrow.address)
    ).toBigInt();

    console.log('jackie End Balance', jackieEndBalance);
    console.log('mintedSoFar after second withdrawal', mintedSoFar2);
    console.log('escrowBalanceAfter2Withdraw', escrowBalanceAfter2Withdraw);

    assert.equal(
      jackieEndBalance,
      totalAmountLocked.toBigInt(),
      'jackie end balance incorrect'
    );

    assert.equal(
      mintedSoFar2,
      totalAmountLocked.toBigInt(),
      'minted so far incorrect'
    );
    assert.equal(
      escrowBalanceAfter2Withdraw,
      depositAmount.sub(totalAmountLocked).toBigInt(),
      'escrow balance after second withdrawal incorrect'
    );
    // let a = Mina.getAccount(jackie, token.deriveTokenId());
    // let a = await fetchAccount({
    //   publicKey: jackie,
    //   tokenId: token.deriveTokenId(),
    // });
    // if (a.account === undefined) {
    //   console.log('error: ', a.error);
    // } else {

    // }
    // const txn = await Mina.transaction(
    //   {
    //     sender: jackie,
    //     fee,
    //   },
    //   async () => {
    //     await token.mint(jackie, new UInt64(77777));
    //   }
    // );
    // console.log(txn.toPretty());
    // await txn.prove();
    // txn.sign([jackie.key, owner.key]);
    // await txn.send().then((v) => v.wait());
    // const jackieLatestBalance = (await token.getBalanceOf(jackie)).toBigInt();
    // console.log('jackieLatestBalance', jackieLatestBalance);
    // let b = Mina.getAccount(jackie, token.deriveTokenId());
    // console.log('newState B', b.zkapp.appState[0].toString());
  });
});

// console.log('Deploying token contract.');
// const deployTokenTx = await Mina.transaction(
//   {
//     sender: deployer,
//     fee,
//   },
//   async () => {
//     AccountUpdate.fundNewAccount(deployer, 3);
//     await adminContract.deploy({ adminPublicKey: admin.publicKey });
//     await token.deploy({
//       symbol: 'abc',
//       src: 'https://github.com/MinaFoundation/mina-fungible-token/blob/main/FungibleToken.ts',
//       allowUpdates: true,
//     });
//     await token.initialize(
//       admin.publicKey,
//       UInt8.from(9),
//       // We can set `startPaused` to `Bool(false)` here, because we are doing an atomic deployment
//       // If you are not deploying the admin and token contracts in the same transaction,
//       // it is safer to start the tokens paused, and resume them only after verifying that
//       // the admin contract has been deployed
//       Bool(true)
//     );
//   }
// );
// await deployTokenTx.prove();
// deployTokenTx.sign([deployer.key, tokenContract.privateKey, admin.privateKey]);
// const deployTokenTxResult = await deployTokenTx.send().then((v) => v.wait());
// console.log('Deploy token tx result:', deployTokenTxResult.toPretty());
// assert.equal(deployTokenTxResult.status, 'included');

// console.log('Deploying escrow contract.');
// const deployEscrowTx = await Mina.transaction(
//   {
//     sender: deployer,
//     fee,
//   },
//   async () => {
//     AccountUpdate.fundNewAccount(deployer, 1);
//     await escrow.deploy({
//       tokenAddress: tokenContract.publicKey,
//       owner,
//     });
//     await token.approveAccountUpdate(escrow.self);
//   }
// );
// await deployEscrowTx.prove();
// deployEscrowTx.sign([deployer.key, escrowContract.privateKey]);
// const deployEscrowTxResult = await deployEscrowTx.send().then((v) => v.wait());
// console.log('Deploy escrow tx result:', deployEscrowTxResult.toPretty());
// assert.equal(deployEscrowTxResult.status, 'included');

// console.log('Minting new tokens to Alexa and Billy.');
// const mintTx1 = await Mina.transaction(
//   {
//     sender: owner,
//     fee,
//   },
//   async () => {
//     AccountUpdate.fundNewAccount(owner, 1);
//     await token.mint(alexa, new UInt64(2e9));
//   }
// );
// await mintTx1.prove();
// mintTx1.sign([owner.key, admin.privateKey]);
// const mintTxResult1 = await mintTx1.send().then((v) => v.wait());
// console.log('Mint tx result 1:', mintTxResult1.toPretty());
// assert.equal(mintTxResult1.status, 'included');

// const mintTx2 = await Mina.transaction(
//   {
//     sender: owner,
//     fee,
//   },
//   async () => {
//     AccountUpdate.fundNewAccount(owner, 1);
//     await token.mint(billy, new UInt64(3e9));
//   }
// );
// await mintTx2.prove();
// mintTx2.sign([owner.key, admin.privateKey]);
// const mintTxResult2 = await mintTx2.send().then((v) => v.wait());
// console.log('Mint tx result 2:', mintTxResult2.toPretty());
// assert.equal(mintTxResult2.status, 'included');

// console.log('Alexa deposits tokens to the escrow.');
// const depositTx1 = await Mina.transaction(
//   {
//     sender: alexa,
//     fee,
//   },
//   async () => {
//     await escrow.deposit(new UInt64(2e9));
//     await token.approveAccountUpdate(escrow.self);
//   }
// );
// await depositTx1.prove();
// depositTx1.sign([alexa.key]);
// const depositTxResult1 = await depositTx1.send().then((v) => v.wait());
// console.log('Deposit tx result 1:', depositTxResult1.toPretty());
// assert.equal(depositTxResult1.status, 'included');

// const escrowBalanceAfterDeposit1 = (
//   await token.getBalanceOf(escrowContract.publicKey)
// ).toBigInt();
// console.log(
//   'Escrow balance after 1st deposit:',
//   escrowBalanceAfterDeposit1 / 1_000_000_000n
// );
// assert.equal(escrowBalanceAfterDeposit1, BigInt(2e9));

// console.log('Billy deposits tokens to the escrow.');
// const depositTx2 = await Mina.transaction(
//   {
//     sender: billy,
//     fee,
//   },
//   async () => {
//     await escrow.deposit(new UInt64(3e9));
//     await token.approveAccountUpdate(escrow.self);
//   }
// );
// await depositTx2.prove();
// depositTx2.sign([billy.key]);
// const depositTxResult2 = await depositTx2.send().then((v) => v.wait());
// console.log('Deposit tx result 2:', depositTxResult2.toPretty());
// assert.equal(depositTxResult2.status, 'included');

// const escrowBalanceAfterDeposit2 = (
//   await token.getBalanceOf(escrowContract.publicKey)
// ).toBigInt();
// console.log(
//   'Escrow balance after 2nd deposit:',
//   escrowBalanceAfterDeposit2 / 1_000_000_000n
// );
// assert.equal(escrowBalanceAfterDeposit2, BigInt(5e9));

// const escrowTotalAfterDeposits = escrow.total.get();
// assert.equal(escrowTotalAfterDeposits.toBigInt(), escrowBalanceAfterDeposit2);

// console.log('Escrow owner withdraws portion of tokens to Jackie.');
// const withdrawTx = await Mina.transaction(
//   {
//     sender: owner,
//     fee,
//   },
//   async () => {
//     AccountUpdate.fundNewAccount(owner, 1);
//     await escrow.withdraw(jackie, new UInt64(4e9));
//     await token.approveAccountUpdate(escrow.self);
//   }
// );
// await withdrawTx.prove();
// withdrawTx.sign([owner.key]);
// const withdrawTxResult = await withdrawTx.send().then((v) => v.wait());
// console.log('Withdraw tx result:', withdrawTxResult.toPretty());
// assert.equal(withdrawTxResult.status, 'included');

// const escrowBalanceAfterWithdraw = (
//   await token.getBalanceOf(escrowContract.publicKey)
// ).toBigInt();
// console.log(
//   'Escrow balance after withdraw:',
//   escrowBalanceAfterWithdraw / 1_000_000_000n
// );
// assert.equal(escrowBalanceAfterWithdraw, BigInt(1e9));

// console.log(
//   'Jackie should fail to withdraw all remaining in escrow contract tokens directly without using escrow contract.'
// );
// const directWithdrawTx = await Mina.transaction(
//   {
//     sender: jackie,
//     fee,
//   },
//   async () => {
//     await token.transfer(escrowContract.publicKey, jackie, new UInt64(1e9));
//   }
// );
// await directWithdrawTx.prove();
// directWithdrawTx.sign([jackie.key, escrowContract.privateKey]);
// const directWithdrawTxResult = await directWithdrawTx.safeSend();
// console.log('Direct Withdraw tx status:', directWithdrawTxResult.status);
// assert.equal(directWithdrawTxResult.status, 'rejected');

// const escrowBalanceAfterDirectWithdraw = (
//   await token.getBalanceOf(escrowContract.publicKey)
// ).toBigInt();
// console.log(
//   'Escrow balance after the attempt of direct withdraw:',
//   escrowBalanceAfterDirectWithdraw / 1_000_000_000n
// );
// assert.equal(escrowBalanceAfterDirectWithdraw, BigInt(1e9));

// const escrowTotalAfterWithdraw = escrow.total.get();
// assert.equal(escrowTotalAfterWithdraw.toBigInt(), escrowBalanceAfterWithdraw);
