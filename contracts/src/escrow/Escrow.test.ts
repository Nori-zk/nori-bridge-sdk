import {
  AccountUpdate,
  Bool,
  Field,
  Mina,
  PrivateKey,
  PublicKey,
  UInt64,
  UInt8,
} from 'o1js';
import { FungibleToken, FungibleTokenAdmin } from '../index.js';
import { TokenEscrow } from './Escrow.js';
import assert from 'node:assert';
import { test, describe, before } from 'node:test';

const proofsEnabled = true;
const enforceTransactionLimits = false;

type Keypair = {
  publicKey: PublicKey;
  privateKey: PrivateKey;
};

describe('Escrow', async () => {
  const fee = 1e8;
  let deployer: Mina.TestPublicKey,
    owner: Mina.TestPublicKey,
    alexa: Mina.TestPublicKey,
    billy: Mina.TestPublicKey,
    jackie: Mina.TestPublicKey;
  let token: FungibleToken;
  let tokenId: Field;
  let escrow: TokenEscrow;
  let adminContract: FungibleTokenAdmin;
  let tokenContract: Keypair, escrowContract: Keypair, admin: Keypair;

  before(async () => {
    if (proofsEnabled) {
      await TokenEscrow.compile();
      await FungibleToken.compile();
      await FungibleTokenAdmin.compile();
    }
    const Local = await Mina.LocalBlockchain({
      proofsEnabled,
      enforceTransactionLimits,
    });
    Mina.setActiveInstance(Local);
    [deployer, owner, alexa, billy, jackie] = Local.testAccounts;
    tokenContract = PrivateKey.randomKeypair();
    escrowContract = PrivateKey.randomKeypair();
    admin = PrivateKey.randomKeypair();
    console.log(`
          deployer ${deployer.toBase58()}
          owner ${owner.toBase58()}
          alexa ${alexa.toBase58()}
          billy ${billy.toBase58()}
          jackie ${jackie.toBase58()}
          token ${tokenContract.publicKey.toBase58()}
          escrow ${escrowContract.publicKey.toBase58()}
          admin ${admin.publicKey.toBase58()}
        `);
    token = new FungibleToken(tokenContract.publicKey);
    tokenId = token.deriveTokenId();
    escrow = new TokenEscrow(escrowContract.publicKey, tokenId);
    adminContract = new FungibleTokenAdmin(admin.publicKey);
  });

  async function deployToken() {
    const txn = await Mina.transaction(
      {
        sender: deployer,
        fee,
      },
      async () => {
        AccountUpdate.fundNewAccount(deployer, 2);
        await adminContract.deploy({ adminPublicKey: admin.publicKey });
        await token.deploy({
          symbol: 'abc',
          src: 'https://github.com/MinaFoundation/mina-fungible-token/blob/main/FungibleToken.ts',
          allowUpdates: true,
        });
      }
    );
    await txn.prove();
    txn.sign([deployer.key, tokenContract.privateKey, admin.privateKey]);
    await txn.send().then((v) => v.wait());
  }

  async function initialiseTokenContract() {
    const txn = await Mina.transaction(
      {
        sender: deployer,
        fee,
      },
      async () => {
        AccountUpdate.fundNewAccount(deployer, 1);

        await token.initialize(
          admin.publicKey,
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
    txn.sign([deployer.key, tokenContract.privateKey, admin.privateKey]);
    await txn.send().then((v) => v.wait());
  }

  test('deploy token contract test', async () => {
    // Code here, adminKey in adminContract private
    // errors around the token pause value
  });

  test('initialise token contract test', async () => {
    await deployToken();
    await initialiseTokenContract();

    const tokenAdminKey = await token.admin.get();
    const tokenDecimal = await token.decimals.fetch();
    assert.equal(tokenAdminKey.toBase58(), admin.publicKey.toBase58());
    assert.equal(tokenDecimal, 9);
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
