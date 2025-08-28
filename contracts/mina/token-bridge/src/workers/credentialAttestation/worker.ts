import { AccountUpdate, Mina, PrivateKey, PublicKey } from 'o1js';
import {
    compileEcdsaEthereum,
    compileEcdsaSigPresentationVerifier,
    createEcdsaMinaCredential,
    createEcdsaSigPresentation,
    createEcdsaSigPresentationRequest,
    EcdsaSigPresentationVerifier,
    ProvableEcdsaSigPresentation,
} from '../../credentialAttestation.js';
import {
    EnforceMaxLength,
    SecretMaxLength,
} from '../../credentialAttestationUtils.js';
import { Presentation } from 'mina-attestations';

export class CredentialAttestationWorker {
    async compile() {
        // Compile programs / contracts
        console.log('awaiting compileEcdsaEthereum()');
        console.time('compileEcdsaEthereum');
        await compileEcdsaEthereum();
        console.timeEnd('compileEcdsaEthereum'); // 1:20.330 (m:ss.mmm)

        console.log('awaiting compileEcdsaSigPresentationVerifier()');
        console.time('compileEcdsaSigPresentationVerifier');
        await compileEcdsaSigPresentationVerifier();
        console.timeEnd('compileEcdsaSigPresentationVerifier'); // 11.507s
    }

    async computeEcdsaSigPresentationRequest(zkAppPublicKeyBase58: string) {
        const zkAppPublicKey = PublicKey.fromBase58(zkAppPublicKeyBase58);
        console.log('Awaiting createEcdsaSigPresentationRequest()');
        console.time('createEcdsaSigPresentationRequest');
        const presentationRequestJson = await createEcdsaSigPresentationRequest(
            zkAppPublicKey
        );
        console.timeEnd('createEcdsaSigPresentationRequest'); // 1.348ms
        return presentationRequestJson;
    }

    async computeCredential<FixedString extends string>(
        secret: EnforceMaxLength<FixedString, SecretMaxLength>,
        ethSecretSignature: string,
        ethWalletAddress: string,
        minaPublicKeyBase58: string
    ) {
        console.log('minaPublicKeyBase58', minaPublicKeyBase58);
        const minaPublicKey = PublicKey.fromBase58(minaPublicKeyBase58);
        console.log('Awaiting createEcdsaMinaCredential()');
        console.time('createEcdsaMinaCredential');
        const credentialJson = await createEcdsaMinaCredential(
            ethSecretSignature,
            ethWalletAddress,
            minaPublicKey,
            secret
        );
        console.timeEnd('createEcdsaMinaCredential'); // 2:02.513 (m:ss.mmm)
        return credentialJson;
    }

    async WALLET_computeEcdsaSigPresentation(
        presentationRequestJson: string,
        credentialJson: string,
        minaPrivateKeyBase58: string
    ) {
        console.log('Awaiting createEcdsaSigPresentation()');
        console.time('createEcdsaSigPresentation');
        const minaPrivateKey = PrivateKey.fromBase58(minaPrivateKeyBase58);
        const presentationJson = await createEcdsaSigPresentation(
            presentationRequestJson,
            credentialJson,
            minaPrivateKey
        );
        console.timeEnd('createEcdsaSigPresentation'); // 46.801s
        return presentationJson;
    }

    /**
     * @deprecated This method is deprecated and will be removed in a future version.
     */
    private async minaSetup() {
        const Network = Mina.Network({
            networkId: 'devnet',
            mina: 'http://localhost:8080/graphql',
        });
        Mina.setActiveInstance(Network);
    }

    /**
     * @deprecated This method is deprecated and will be removed in a future version.
     */
    async MOCK_deployAndVerifyEcdsaSigPresentationVerifier(
        zkAppPrivateKeyBase58: string,
        senderPrivateKeyBase58: string,
        presentationJSON: string
    ) {
        await this.minaSetup();
        const senderPrivateKey = PrivateKey.fromBase58(senderPrivateKeyBase58);
        const zkAppPrivateKey = PrivateKey.fromBase58(zkAppPrivateKeyBase58);
        const senderPublicKey = senderPrivateKey.toPublicKey();
        const zkAppPublicKey = zkAppPrivateKey.toPublicKey();
        const zkApp = new EcdsaSigPresentationVerifier(zkAppPublicKey);
        const deployTx = await Mina.transaction(
            { sender: senderPublicKey, fee: 0.01 * 1e9 },
            async () => {
                AccountUpdate.fundNewAccount(senderPublicKey);
                await zkApp.deploy();
                const presentation = Presentation.fromJSON(presentationJSON);
                const provablePresentation =
                    ProvableEcdsaSigPresentation.from(presentation);
                const claims = await zkApp.verifyPresentation(
                    provablePresentation
                );
                console.log('✅ ProvablePresentation verified!');
                console.log('ProvableEcdsaSigPresentation claims:', claims);
            }
        );

        console.log('Deploy transaction created successfully. Proving...');
        await deployTx.prove();
        console.log(
            'Transaction proved. Signing and sending the transaction...'
        );
        await deployTx.sign([senderPrivateKey, zkAppPrivateKey]).send().wait();
        console.log(
            '✅ EcdsaSigPresentationVerifier deployed and verified successfully.'
        );
    }
}
