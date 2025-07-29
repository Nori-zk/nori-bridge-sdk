import { PrivateKey, PublicKey } from 'o1js';
import {
    compileEcdsaEthereum,
    compileEcdsaSigPresentationVerifier,
    createEcdsaMinaCredential,
    createEcdsaSigPresentation,
    createEcdsaSigPresentationRequest,
    EnforceMaxLength,
    SecretMaxLength,
} from '../../credentialAttestation.js';

export class CredentialAttestationWorker {
    async compile() {
        // Compile programs / contracts
        console.time('compileEcdsaEthereum');
        await compileEcdsaEthereum();
        console.timeEnd('compileEcdsaEthereum'); // 1:20.330 (m:ss.mmm)

        console.time('compilePresentationVerifier');
        await compileEcdsaSigPresentationVerifier();
        console.timeEnd('compilePresentationVerifier'); // 11.507s
    }

    async computeEcdsaSigPresentationRequest(zkAppPublicKeyBase58: string) {
        const zkAppPublicKey = PublicKey.fromBase58(zkAppPublicKeyBase58);
        console.time('getPresentationRequest');
        const presentationRequestJson = await createEcdsaSigPresentationRequest(
            zkAppPublicKey
        );
        console.timeEnd('getPresentationRequest'); // 1.348ms
        return presentationRequestJson;
    }

    async computeCredential<FixedString extends string>(
        secret: EnforceMaxLength<FixedString, SecretMaxLength>,
        ethSecretSignature: string,
        ethWalletAddress: string,
        minaPublicKeyBase58: string
    ) {
        const minaPublicKey = PublicKey.fromBase58(minaPublicKeyBase58);
        console.time('createCredential');
        const credentialJson = await createEcdsaMinaCredential(
            ethSecretSignature,
            ethWalletAddress,
            minaPublicKey,
            secret
        );
        console.timeEnd('createCredential'); // 2:02.513 (m:ss.mmm)
        return credentialJson;
    }

    async computeEcdsaSigPresentation(
        presentationRequestJson: string,
        credentialJson: string,
        minaPrivateKeyBase58: string
    ) {
        console.time('getPresentation');
        const minaPrivateKey = PrivateKey.fromBase58(minaPrivateKeyBase58);
        const presentationJson = await createEcdsaSigPresentation(
            presentationRequestJson,
            credentialJson,
            minaPrivateKey
        );
        console.timeEnd('getPresentation'); // 46.801s
        return presentationJson;
    }
}
