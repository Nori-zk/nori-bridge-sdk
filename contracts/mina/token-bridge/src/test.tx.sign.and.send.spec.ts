import {
    Mina,
    declareMethods,
    SmartContract,
    PrivateKey,
    Field,
    NetworkId,
    Transaction
} from 'o1js';
import { getTokenMintWorker } from './workers/tokenMint/node/parent.js';

describe('sign_and_send', () => {
    test('tx helper', async () => {
        const worker = getTokenMintWorker();
        const zkAppPriv = PrivateKey.random();
        const zkAppAddress = zkAppPriv.toPublicKey();
        class ZkAppVerifier extends SmartContract {
            async verifyPresentation() {
                Field(1).assertEquals(Field(1));
            }
        }
        declareMethods(ZkAppVerifier, {
            verifyPresentation: [], // TODO bad TS interface
        });
        console.log('time to compile zkapp');
        await ZkAppVerifier.compile();
        let Local =  Mina.Network({networkId: 'devnet' as NetworkId,mina: 'http://localhost:8080/graphql'});
        Mina.setActiveInstance(Local);
        console.log('time to create tx');
        let tx = await Mina.transaction(() =>
            new ZkAppVerifier(zkAppAddress).verifyPresentation()
        );
        const provedtx= await tx.prove();

        const txJson = provedtx.toJSON();
        console.log(txJson);

        // worker.minaSetup({
        //     networkId: 'devnet' as NetworkId,
        //     mina: 'http://localhost:8080/graphql',
        // });
        // const { txHash } = await worker.WALLET_signAndSend(txJson);
        const tx1 = Transaction.fromJSON(
            JSON.parse(txJson) as any
        ) as unknown as Mina.Transaction<true, false>;

        const result = await tx1.sign([zkAppPriv]).send().wait();
        console.log('txHash', result);
    });
});
