import { Bytes, Field, NetworkId, PrivateKey, PublicKey } from 'o1js';
import {
    getEthWallet,
    getNewMinaLiteNetAccountSK,
    lockTokens,
} from './testUtils.js';
import { wordToBytes } from '@nori-zk/proof-conversion';
import { getReconnectingBridgeSocket$ } from './rx/socket.js';
import {
    getBridgeStateTopic$,
    getBridgeTimingsTopic$,
    getEthStateTopic$,
} from './rx/topics.js';
import {
    combineLatest,
    filter,
    firstValueFrom,
    lastValueFrom,
    switchMap,
    take,
} from 'rxjs';
import {
    BridgeDepositProcessingStatus,
    getDepositProcessingStatus$,
} from './rx/deposit.js';
import { TransitionNoticeMessageType } from '@nori-zk/pts-types';
import { signSecret } from './ethSignature.js';
import { deployTokenController } from './NoriTokenControllerDeploy.js';
import { getSecretHashFromPresentationJson } from './credentialAttestation.js';
import { getTokenMintWorker } from './workers/tokenMint/node/parent.js';
import { getMockWalletWorker } from './workers/mockWallet/node/parent.js';
import { getTokenDeployer } from './workers/tokenDeployer/node/parent.js';

describe('e2e', () => {
    test('e2e_complete', async () => {
        const minaConfig = {
            networkId: 'devnet' as NetworkId,
            mina: 'http://localhost:8080/graphql',
        };

        // Init workers
        const tokenMintWorker = getTokenMintWorker();
        //const mockWalletWorker = getMockWalletWorker();

        // Configure workers FIXME not sure we need this for both we will only be sending tx's from one place.

        //mockWalletWorker.minaSetup(minaConfig);
        tokenMintWorker.minaSetup(minaConfig);

        //await mockWalletWorker.compileCredentialDeps();
        await tokenMintWorker.compileCredentialDeps();

        // We should compile what we need for deposit attestation based of an event but for now
        await tokenMintWorker.compileEthDepositProgramDeps();

        // Compile what we need for minting
        const tokenMintWorkerMintReady = tokenMintWorker.compileMinterDeps();
        await tokenMintWorkerMintReady;

        // Deploy token minter contracts
        /*const {
            tokenBaseAddress: tokenBaseAddressBase58,
            noriTokenControllerAddress: noriTokenControllerAddressBase58,
        } = await deployTokenController();*/

        // Use the worker to save some ram
        const tokenDeployer = getTokenDeployer();
        const storageInterfaceVerificationKeySafe: {
            data: string;
            hashStr: string;
        } = await tokenDeployer.compile();
        const contractsLitenetSk = await getNewMinaLiteNetAccountSK();
        const contractSenderPrivateKey =
            PrivateKey.fromBase58(contractsLitenetSk);
        const contractSenderPrivateKeyBase58 =
            contractSenderPrivateKey.toBase58();
        //const contractSenderPublicKey = contractSenderPrivateKey.toPublicKey();
        //const adminPrivateKey = PrivateKey.random();
        const tokenControllerPrivateKey = PrivateKey.random();
        const tokenBasePrivateKey = PrivateKey.random();
        const ethProcessorAddress = PrivateKey.random()
            .toPublicKey()
            .toBase58();
        await tokenDeployer.minaSetup(minaConfig);
        const {
            tokenBaseAddress: tokenBaseAddressBase58,
            noriTokenControllerAddress: noriTokenControllerAddressBase58,
        } = await tokenDeployer.deployContracts(
            contractSenderPrivateKeyBase58,
            contractSenderPrivateKeyBase58, // Admin
            tokenControllerPrivateKey.toBase58(),
            tokenBasePrivateKey.toBase58(),
            ethProcessorAddress,
            storageInterfaceVerificationKeySafe,
            0.1 * 1e9,
            {
                symbol: 'nETH',
                decimals: 18,
                allowUpdates: true,
            }
        );
        tokenDeployer.terminate();

        // Before we start we need, to compile pre requisites access to a wallet and an attested credential....

        // GET WALLET **************************************************
        const ethWallet = await getEthWallet();
        const ethAddressLowerHex = ethWallet.address.toLowerCase();

        // SETUP MINA **************************************************

        // Generate a funded test private key for mina litenet
        const litenetSk = await getNewMinaLiteNetAccountSK();
        const senderPrivateKey = PrivateKey.fromBase58(litenetSk);
        const senderPrivateKeyBase58 = senderPrivateKey.toBase58();
        const senderPublicKey = senderPrivateKey.toPublicKey();
        const senderPublicKeyBase58 = senderPublicKey.toBase58();

        // Configure wallet
        // In reality we would not pass this from the main thread.
        tokenMintWorker.WALLET_setMinaPrivateKey(senderPrivateKeyBase58);

        // OBTAIN CREDENTIAL **************************************************

        // CLIENT *******************
        const secret = 'IAmASecretOfLength20';
        // Get signature
        console.time('ethSecretSignature');
        const ethSecretSignature = await signSecret(secret, ethWallet);
        console.timeEnd('ethSecretSignature');

        console.log('ethSecretSignature', ethSecretSignature);
        console.log('senderPrivateKey.toBase58()', senderPrivateKeyBase58);
        console.log('senderPublicKey.toBase58()', senderPublicKeyBase58);

        // WALLET or CLIENT?? *******************
        // await tokenMintWorkerCredentialsReady;
        // Create credential
        console.time('createCredential');
        const credentialJson = await tokenMintWorker.computeCredential(
            secret,
            ethSecretSignature,
            ethWallet.address,
            senderPublicKeyBase58
        );
        console.timeEnd('createCredential'); // 2:02.513 (m:ss.mmm)

        // CLIENT *******************
        // Create a presentation request
        // This is sent from the client to the WALLET
        console.time('getPresentationRequest');
        const presentationRequestJson =
            await tokenMintWorker.computeEcdsaSigPresentationRequest(
                noriTokenControllerAddressBase58
            );
        console.timeEnd('getPresentationRequest'); // 1.348ms

        // WALLET ********************
        // WALLET takes a presentation request and the WALLET can retrieve the stored credential
        // From this it creates a presentation.
        console.time('getPresentation');
        const presentationJsonStr =
            await tokenMintWorker.WALLET_computeEcdsaSigPresentation(
                presentationRequestJson,
                credentialJson
            );
        console.timeEnd('getPresentation'); // 46.801s

        // Extract hashed secret

        const { credentialAttestationBEHex, credentialAttestationHashField } =
            getSecretHashFromPresentationJson(presentationJsonStr);
        console.log('attestationBEHex', credentialAttestationBEHex);

        // CONNECT TO BRIDGE **************************************************

        // Establish a connection to the bridge and listen to topics.
        console.log('Establishing bridge connection and topics.');
        const { bridgeSocket$, bridgeSocketConnectionState$ } =
            getReconnectingBridgeSocket$();

        bridgeSocketConnectionState$.subscribe({
            next: (state) => console.log(`[WS] ${state}`),
            error: (state) => console.error(`[WS] ${state}`),
            complete: () =>
                console.log('[WS] Bridge socket connection completed.'),
        });

        const ethStateTopic$ = getEthStateTopic$(bridgeSocket$);
        const bridgeStateTopic$ = getBridgeStateTopic$(bridgeSocket$);
        const bridgeTimingsTopic$ = getBridgeTimingsTopic$(bridgeSocket$);

        // Wait for bridge topics to be ready.
        console.time('bridgeStateReady');
        await firstValueFrom(
            combineLatest([
                ethStateTopic$,
                bridgeStateTopic$,
                bridgeTimingsTopic$,
            ])
        );
        console.timeEnd('bridgeStateReady');

        // LOCK TOKENS **************************************************

        console.time('lockingTokens');
        const depositBlockNumber = await lockTokens(
            credentialAttestationHashField,
            0.000001
        );
        console.timeEnd('lockingTokens');

        // WAIT FOR BRIDGE PROCESSING **************************************************

        // Get deposit status.
        const depositProcessingStatus$ = getDepositProcessingStatus$(
            depositBlockNumber,
            ethStateTopic$,
            bridgeStateTopic$,
            bridgeTimingsTopic$
        );

        depositProcessingStatus$.subscribe({
            next: console.log,
            error: console.error,
            complete: () => console.log('Deposit processing completed'),
        });

        // Compute proof
        console.log(
            'Waiting for ProofConversionJobSucceeded on WaitingForCurrentJobCompletion before we can compute.'
        );

        const { ethDepositProofJson, despositSlotRaw } = await firstValueFrom(
            depositProcessingStatus$.pipe(
                filter(
                    ({ deposit_processing_status, stageName }) =>
                        deposit_processing_status ===
                            BridgeDepositProcessingStatus.WaitingForCurrentJobCompletion &&
                        stageName ===
                            TransitionNoticeMessageType.ProofConversionJobSucceeded
                ),
                take(1),
                switchMap(async () => {
                    //await tokenMintWorkerEthDepositProgramReady;
                    console.log('Computing proofs...');
                    const { ethDepositProofJson, despositSlotRaw } =
                        await tokenMintWorker.computeEthDeposit(
                            presentationJsonStr,
                            depositBlockNumber,
                            ethAddressLowerHex
                        );
                    return {
                        ethDepositProofJson,
                        despositSlotRaw,
                    };
                })
            )
        );

        console.log(
            `bridge head [attestationHash] (BE hex):`,
            despositSlotRaw.slot_nested_key_attestation_hash
        );

        // Compile what we need for minting
        //const tokenMintWorkerMintReady = tokenMintWorker.compileMinterDeps();

        // Block until deposit has been processed
        console.log(
            'Waiting for deposit processing completion before we can complete the minting process.'
        );
        await lastValueFrom(depositProcessingStatus$);
        console.log('Deposit is processed unblocking mint process.');

        // COMPUTE PRESENTATION VERIFIER **************************************************

        const noriTokenControllerVerificationKeySafe =
            await tokenMintWorkerMintReady;
        console.time('noriMinter.setupStorage');
        const provedSetupTxStr = await tokenMintWorker.setupStorage(
            senderPublicKeyBase58,
            noriTokenControllerAddressBase58, // CHECKME @Karol
            0.1 * 1e9,
            noriTokenControllerVerificationKeySafe
        );
        const { txHash: setupTxHash } = await tokenMintWorker.WALLET_signAndSend(
            provedSetupTxStr
        );
        console.log('setupTxHash', setupTxHash);
        console.timeEnd('noriMinter.setupStorage');

        console.time('Minting');
        const provedMintTxStr = await tokenMintWorker.mint(
            senderPublicKeyBase58,
            noriTokenControllerAddressBase58, // CHECKME @Karol
            {
                ethDepositProofJson: ethDepositProofJson,
                presentationProofStr: presentationJsonStr,
            },
            1e9 * 0.1,
            true
        );
        const { txHash: mintTxHash } = await tokenMintWorker.WALLET_signAndSend(
            provedMintTxStr
        );
        console.log('mintTxHash', mintTxHash);
        console.timeEnd('Minted');

        console.log('Minted!');
    }, 1000000000);
});
