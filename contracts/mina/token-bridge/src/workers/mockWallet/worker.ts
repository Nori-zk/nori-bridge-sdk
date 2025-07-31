import { fetchAccount, Mina, NetworkId, PrivateKey, PublicKey, Transaction } from 'o1js';
import {
    compileEcdsaEthereum,
    compileEcdsaSigPresentationVerifier,
    createEcdsaSigPresentation,
} from '../../credentialAttestation.js';

export class MockWalletWorker {
    // Initialise methods
    #minaPrivateKey: PrivateKey;
    async setMinaPrivateKey(minaPrivateKeyBase58: string) {
        if (this.#minaPrivateKey)
            throw new Error('Mina private key has already been set.');
        this.#minaPrivateKey = PrivateKey.fromBase58(minaPrivateKeyBase58);
    }

    // CREDENTIAL METHODS ******************************************************************************
    //credential (compile)
    async compileCredentialDeps() {
        // Compile programs / contracts
        console.time('compileEcdsaEthereum');
        await compileEcdsaEthereum();
        console.timeEnd('compileEcdsaEthereum'); // 1:20.330 (m:ss.mmm)

        console.time('compilePresentationVerifier');
        await compileEcdsaSigPresentationVerifier();
        console.timeEnd('compilePresentationVerifier'); // 11.507s
    }

    // Credential methods

    async computeEcdsaSigPresentation(
        presentationRequestJson: string,
        credentialJson: string
    ) {
        console.time('getPresentation');
        const presentationJson = await createEcdsaSigPresentation(
            presentationRequestJson,
            credentialJson,
            this.#minaPrivateKey
        );
        console.timeEnd('getPresentation'); // 46.801s
        return presentationJson;
    }

    // Mina setup ******************************************************************************

    async minaSetup(options: {
        networkId?: NetworkId;
        mina: string | string[];
        archive?: string | string[];
        lightnetAccountManager?: string;
        bypassTransactionLimits?: boolean;
        minaDefaultHeaders?: HeadersInit;
        archiveDefaultHeaders?: HeadersInit;
    }) {
        const Network = Mina.Network(options);
        Mina.setActiveInstance(Network);
    }

    //  ******************************************************************************

    private async fetchAccounts(accounts: PublicKey[]): Promise<void> {
        await Promise.all(
            accounts.map((addr) => fetchAccount({ publicKey: addr }))
        );
    }

    // Sign and send transaction

    async sign(provedTxJsonStr: string) {
        // FIXME this is a crazy interface....
        
        //Mina.Transaction
        const tx = Transaction.fromJSON(provedTxJsonStr as any) as unknown as Mina.Transaction<true, false>;
        throw new Error('sign is not gonna work as implemented here');

        const signedTx = tx.sign([this.#minaPrivateKey]);

        // Do we need to send also?? not sure if we return it to the client to do that

        return signedTx.toJSON();


        //Mina.Transaction<false,false>.fromJSON() ;//.fromJSON(); //txJsonStr as unknown as ZkappCommand);
    }

    // Not sure if the wallet should do this.... or the worker FIXME
    async send(signedAndProvedTxJsonStr: string) {
        const tx = Transaction.fromJSON(signedAndProvedTxJsonStr as any) as unknown as Mina.Transaction<true, false>;
        throw new Error('send is not gonna work as implemented here');
        const result = await tx.send().wait();
        return { txHash: result.hash };
    }

}
