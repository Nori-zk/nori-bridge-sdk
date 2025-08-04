import { AccountUpdate, Field, Mina, PrivateKey, PublicKey } from 'o1js';
import {
    compileEcdsaEthereum,
    compileEcdsaSigPresentationVerifier,
    createEcdsaMinaCredential,
    createEcdsaSigPresentation,
    createEcdsaSigPresentationRequest,
    EcdsaSigPresentationVerifier,
    hashSecret,
    ProvableEcdsaSigPresentation,
    verifyEcdsaSigPresentation,
} from './credentialAttestation.js';
import { Presentation } from 'mina-attestations';
import { getNewMinaLiteNetAccountSK } from './testUtils.js';
import { signSecret } from './ethSignature.js';
import { getCredentialAttestation } from './workers/credentialAttestation/node/parent.js';
import { getMockVerification } from './workers/mockCredVerification/node/parent.js';

describe('attestation', () => {
    // Get a private key from .env located within <projectRoot>/contracts/ethereum/.env
    async function getEthereumEnvPrivateKey() {
        const { fileURLToPath } = await import('url');
        const { resolve, dirname } = await import('node:path');
        const __filename = fileURLToPath(import.meta.url);
        const rootDir = dirname(__filename);

        const fs = await import('fs');
        const dotenv = await import('dotenv');

        const envBuffer = fs.readFileSync(
            resolve(rootDir, '..', '..', '..', 'ethereum', '.env')
        );
        const parsed = dotenv.parse(envBuffer);
        return parsed.ETH_PRIVATE_KEY as string;
    }

    // Get eth wallet (WALLETS will implement their own method)
    async function getEthWallet() {
        const privateKey = await getEthereumEnvPrivateKey();
        const { ethers } = await import('ethers');
        return new ethers.Wallet(privateKey);
    }

    // Setup mina lite net
    async function minaSetup() {
        const Network = Mina.Network({
            networkId: 'devnet',
            mina: 'http://localhost:8080/graphql',
        });
        Mina.setActiveInstance(Network);
    }

    // Utility to deploy and invoke the EcdsaSigPresentationVerifier smart contract with a presentationJSON
    async function deployAndVerifyEcdsaSigPresentationVerifier(
        zkAppPrivateKey: PrivateKey,
        senderPrivateKey: PrivateKey,
        presentationJSON: string
    ) {
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

        // May have to verifiy presentation in 2nd tx... Seems like its not necessary.
    }

    test('should_perform_pure_worker_credential_attestation_pipeline', async () => {
        const credentialAttestation = getCredentialAttestation();
        const credentialAttestationReady = credentialAttestation.compile();

        await credentialAttestationReady;

        // Get eth wallet
        const ethWallet = await getEthWallet();

        // Generate a funded test private key for mina litenet
        const litenetSk = await getNewMinaLiteNetAccountSK();
        const minaPrivateKey = PrivateKey.fromBase58(litenetSk);
        const minaPublicKey = minaPrivateKey.toPublicKey();

        // Generate a random zkAppAddress
        const zkAppPrivateKey = PrivateKey.random();
        const zkAppPublicKey = zkAppPrivateKey.toPublicKey();

        // CLIENT *******************
        const secret = 'IAmASecretOfLength20';
        // Get signature
        const ethSecretSignature = await signSecret(secret, ethWallet);

        // WALLET *******************
        // Create credential
        console.time('createCredential');
        const credentialJson = await credentialAttestation.computeCredential(
            secret,
            ethSecretSignature,
            ethWallet.address,
            minaPublicKey.toBase58()
        );
        console.timeEnd('createCredential'); // 2:02.513 (m:ss.mmm)

        // CLIENT *******************
        // Create a presentation request
        // This is sent from the client to the WALLET
        console.time('getPresentationRequest');
        const presentationRequestJson =
            await credentialAttestation.computeEcdsaSigPresentationRequest(
                zkAppPublicKey.toBase58()
            );
        console.timeEnd('getPresentationRequest'); // 1.348ms

        // WALLET ********************
        // WALLET takes a presentation request and the WALLET can retrieve the stored credential
        // From this it creates a presentation.
        console.time('getPresentation');
        const presentationJson =
            await credentialAttestation.WALLET_computeEcdsaSigPresentation(
                presentationRequestJson,
                credentialJson,
                minaPrivateKey.toBase58()
            );
        console.timeEnd('getPresentation'); // 46.801s

        // CLIENT *******************
        // Then the ZKApp verifies the presentation
        // Note the client obviously would not be doing the deploy.

        await credentialAttestation.mockDeployAndVerifyEcdsaSigPresentationVerifier(
            zkAppPrivateKey.toBase58(),
            minaPrivateKey.toBase58(),
            presentationJson
        );
        /*await minaSetup();
        await deployAndVerifyEcdsaSigPresentationVerifier(
            zkAppPrivateKey,
            minaPrivateKey,
            presentationJson
        );*/

        // JUST FOR VALIDATION....
        // Validate compute hashedSecret locally and compare it to the tx claims value.
        const hashedSecret = hashSecret(secret);
        const presentation = JSON.parse(presentationJson);
        const messageHashString =
            presentation.outputClaim.value.messageHash.value;
        const messageHashBigInt = BigInt(messageHashString);
        expect(messageHashBigInt).toEqual(hashedSecret.toBigInt());
    }, 1000000000);

    test('should_perform_worker_credential_attestation_pipeline', async () => {
        const credentialAttestation = getCredentialAttestation();
        const credentialAttestationReady = credentialAttestation.compile();

        // Compile programs / contracts
        console.time('compileEcdsaEthereum');
        await compileEcdsaEthereum();
        console.timeEnd('compileEcdsaEthereum'); // 1:20.330 (m:ss.mmm)

        console.time('compilePresentationVerifier');
        await compileEcdsaSigPresentationVerifier();
        console.timeEnd('compilePresentationVerifier'); // 11.507s

        await credentialAttestationReady;

        // Get eth wallet
        const ethWallet = await getEthWallet();

        // Generate a funded test private key for mina litenet
        const litenetSk = await getNewMinaLiteNetAccountSK();
        const minaPrivateKey = PrivateKey.fromBase58(litenetSk);
        const minaPublicKey = minaPrivateKey.toPublicKey();

        // Generate a random zkAppAddress
        const zkAppPrivateKey = PrivateKey.random();
        const zkAppPublicKey = zkAppPrivateKey.toPublicKey();

        // CLIENT *******************
        const secret = 'IAmASecretOfLength20';
        // Get signature
        const ethSecretSignature = await signSecret(secret, ethWallet);

        // WALLET *******************
        // Create credential
        console.time('createCredential');
        const credentialJson = await credentialAttestation.computeCredential(
            secret,
            ethSecretSignature,
            ethWallet.address,
            minaPublicKey.toBase58()
        );
        console.timeEnd('createCredential'); // 2:02.513 (m:ss.mmm)

        // CLIENT *******************
        // Create a presentation request
        // This is sent from the client to the WALLET
        console.time('getPresentationRequest');
        const presentationRequestJson =
            await credentialAttestation.computeEcdsaSigPresentationRequest(
                zkAppPublicKey.toBase58()
            );
        console.timeEnd('getPresentationRequest'); // 1.348ms

        // WALLET ********************
        // WALLET takes a presentation request and the WALLET can retrieve the stored credential
        // From this it creates a presentation.
        console.time('getPresentation');
        const presentationJson =
            await credentialAttestation.WALLET_computeEcdsaSigPresentation(
                presentationRequestJson,
                credentialJson,
                minaPrivateKey.toBase58()
            );
        console.timeEnd('getPresentation'); // 46.801s

        // CLIENT *******************
        // Then the ZKApp verifies the presentation
        // Note the client obviously would not be doing the deploy.
        await minaSetup();
        await deployAndVerifyEcdsaSigPresentationVerifier(
            zkAppPrivateKey,
            minaPrivateKey,
            presentationJson
        );

        // JUST FOR VALIDATION....
        // Validate compute hashedSecret locally and compare it to the tx claims value.
        const hashedSecret = hashSecret(secret);
        const presentation = JSON.parse(presentationJson);
        const messageHashString =
            presentation.outputClaim.value.messageHash.value;
        const messageHashBigInt = BigInt(messageHashString);
        expect(messageHashBigInt).toEqual(hashedSecret.toBigInt());
    }, 1000000000);
});
