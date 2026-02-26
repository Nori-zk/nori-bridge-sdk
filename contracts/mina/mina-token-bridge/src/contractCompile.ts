/**
 * This script can be used to interact with the Payout zkApp, after deploying it on pre-Mesa local Blockchain.
 */

import { UInt64, AccountUpdate, Mina, PrivateKey, Provable, Cache } from 'o1js';
import { NoriTokenBridge } from './NoriTokenBridge.js';
import { EthVerifier } from '@nori-zk/o1js-zk-utils';

async function main() {
    // Set up the Mina local blockchain
    const Local = await Mina.LocalBlockchain({ proofsEnabled: true });
    Mina.setActiveInstance(Local);

    // Get keys and addresses
    const aliceKey = Local.testAccounts[0].key;
    const alicePubKey = aliceKey.toPublicKey();

    const bobKey = Local.testAccounts[1].key;
    const bobPubKey = bobKey.toPublicKey();

    const dannyKey = Local.testAccounts[2].key;
    const dannyPubKey = dannyKey.toPublicKey();

    const eveKey = Local.testAccounts[3].key;
    const evePubKey = eveKey.toPublicKey();

    // zkApp keypair
    const zkappKey = PrivateKey.random();
    const zkappAddress = zkappKey.toPublicKey();
    const zkapp = new NoriTokenBridge(zkappAddress);

    console.log('Alice PK:', alicePubKey.toBase58());
    console.log('Bob PK:', bobPubKey.toBase58());
    console.log('ZkApp:', zkappAddress.toBase58());

    // Compile (only needed if proofsEnabled = true, but safe to keep)
    await EthVerifier.compile({
        cache: Cache.None
    });
    await NoriTokenBridge.compile({
        cache: Cache.None
    });

    console.log('zkApp compiled successfully!');

    console.log(await NoriTokenBridge.analyzeMethods({ printSummary: true }));


    // Deploy
    const deployTx = await Mina.transaction(
        { sender: alicePubKey, fee: UInt64.from(100_000_000) },
        async () => {
            AccountUpdate.fundNewAccount(alicePubKey); // pay account creation
            await zkapp.deploy();
        }
    );

    // console.log('Deploy Transaction Info:', logTxInfo(deployTx));
    // await deployTx.prove();
    // deployTx.sign([aliceKey, zkappKey]).send();

    // Provable.log('Action state before: ', zkapp.reducer.getActions().hash);
    // const requestTx = await Mina.transaction({ sender: bobPubKey }, async () => {
    //     await zkapp.requestPayout(UInt64.from(1e9));
    // });

    // console.log('Request1 Transaction Info:', logTxInfo(requestTx, 'request'));
    // await requestTx.prove();
    // (await requestTx.sign([bobKey]).send()).safeWait();
    // Provable.log('Action state after: ', zkapp.reducer.getActions().hash);

    // {
    //     const requestTx = await Mina.transaction(
    //         { sender: dannyPubKey },
    //         async () => {
    //             await zkapp.requestPayout(UInt64.from(2e9));
    //         }
    //     );

    //     await requestTx.prove();
    //     console.log('Request counts:', logTxInfo(requestTx), 'request');

    //     (await requestTx.sign([dannyKey]).send()).safeWait();
    // }

    // {
    //     const requestTx = await Mina.transaction(
    //         { sender: evePubKey },
    //         async () => {
    //             //! Test-only: we allow repeat requests (no nullifier / replay protection here)
    //             for (let i = 0; i < 7; i++) await zkapp.requestPayout(UInt64.from(1e9));
    //         }
    //     );

    //     await requestTx.prove();
    //     console.log('Request2 Transaction Info:', logTxInfo(requestTx), 'request');

    //     (await requestTx.sign([eveKey]).send()).safeWait();
    // }

    // console.log(
    //     'Bob account balance before: ',
    //     Local.getAccount(bobPubKey).balance.toBigInt() / 1_000_000_000n
    // );

    // const payoutTx = await Mina.transaction(
    //     { sender: alicePubKey, fee: UInt64.from(1e8) },
    //     async () => {
    //         await zkapp.payout(UInt64.from(2e9));
    //     }
    // );
    // console.log(payoutTx.toPretty());
    // await payoutTx.prove();
    // await payoutTx.sign([aliceKey]).send();

    // console.log('Payout Transaction Info:', logTxInfo(payoutTx));

    // console.log(
    //     'Bob account balance after: ',
    //     Local.getAccount(bobPubKey).balance.toBigInt() / 1_000_000_000n
    // );

    // console.log(
    //     'Danny account balance after: ',
    //     Local.getAccount(dannyPubKey).balance.toBigInt() / 1_000_000_000n
    // );

    // console.log(
    //     'Eve account balance after: ',
    //     Local.getAccount(evePubKey).balance.toBigInt() / 1_000_000_000n
    // );
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});