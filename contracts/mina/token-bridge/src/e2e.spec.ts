import { Bytes, Field, PrivateKey, PublicKey } from 'o1js';
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
import { getDepositAttestation } from './workers/depositAttestation/node/parent.js';
import { getCredentialAttestation } from './workers/credentialAttestation/node/parent.js';
import { getMockVerification } from './workers/mockCredVerification/node/parent.js';
import { getE2e } from './workers/e2eWorker/node/parent.js';
import { deployTokenController } from './NoriTokenControllerDeploy.js';

describe('e2e', () => {
    test('e2e', async () => {
        // Deploy token minter contracts
        const { tokenBaseAddress: tokenBaseAddressBase58, noriTokenControllerAddress: noriTokenControllerAddressBase58 } =
            await deployTokenController();

        const noriTokenControllerAddress = PublicKey.fromBase58(noriTokenControllerAddressBase58);

        // Before we start we need, to compile pre requisites access to a wallet and an attested credential....

        // GET WALLET **************************************************
        const ethWallet = await getEthWallet();
        const ethAddressLowerHex = ethWallet.address.toLowerCase();

        // Init workers
        const depositAttestation = getDepositAttestation();
        const credentialAttestation = getCredentialAttestation();
        const noriMinter = getE2e();

        const depositAttestationWorkerReady = depositAttestation.compile();
        const credentialAttestationReady = credentialAttestation.compile();
        

        // SETUP MINA **************************************************

        // Generate a funded test private key for mina litenet
        const litenetSk = await getNewMinaLiteNetAccountSK();
        const minaPrivateKey = PrivateKey.fromBase58(litenetSk);
        const minaPublicKey = minaPrivateKey.toPublicKey();

        // Deploy needs to done already
        console.log('Readying minter');
        const noriMinterReady = noriMinter.ready({
            senderPrivateKey: minaPrivateKey.toBase58(),
            network: 'devnet',
            networkUrl: 'http://localhost:3000/graphql',
            txFee: 0.1 * 1e9,
            noriTokenControllerAddress: noriTokenControllerAddressBase58,
            tokenBaseAddress: tokenBaseAddressBase58,
            // ethProcessorAddress
        });

        /*

  host: 'localhost',
                port: 8181,
                path: '/acquire-account',
                method: 'GET',
        */


        // Generate a random zkAppAddress
        /*const zkAppPrivateKey = PrivateKey.random();
        const zkAppPublicKey = zkAppPrivateKey.toPublicKey();*/

        // OBTAIN CREDENTIAL **************************************************

        // CLIENT *******************
        const secret = 'IAmASecretOfLength20';
        // Get signature
        console.time('ethSecretSignature');
        const ethSecretSignature = await signSecret(secret, ethWallet);
        console.timeEnd('ethSecretSignature');

        console.log('ethSecretSignature', ethSecretSignature);
        console.log('minaPrivateKey.toBase58()', minaPrivateKey.toBase58());
        console.log('minaPublicKey.toBase58()', minaPublicKey.toBase58());
        //console.log('zkAppPrivateKey.toBase58()', zkAppPrivateKey.toBase58());
        //console.log('zkAppPublicKey.toBase58()', zkAppPublicKey.toBase58());

        // WALLET *******************
        await credentialAttestationReady;
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
                noriTokenControllerAddressBase58
            );
        console.timeEnd('getPresentationRequest'); // 1.348ms

        // WALLET ********************
        // WALLET takes a presentation request and the WALLET can retrieve the stored credential
        // From this it creates a presentation.
        console.time('getPresentation');
        const presentationJson =
            await credentialAttestation.computeEcdsaSigPresentation(
                presentationRequestJson,
                credentialJson,
                minaPrivateKey.toBase58()
            );
        console.timeEnd('getPresentation'); // 46.801s

        // Kill credentialAttestation worker
        credentialAttestation.terminate();

        // Extract hashed secret
        const presentation = JSON.parse(presentationJson);
        const messageHashString =
            presentation.outputClaim.value.messageHash.value;
        const messageHashBigInt = BigInt(messageHashString);
        const credentialAttestationHash = Field.from(messageHashBigInt);
        console.log(
            'credentialAttestationHash from presentation.outputClaim.value.messageHash.value',
            credentialAttestationHash
        );

        const beAttestationHashBytes = Bytes.from(
            wordToBytes(credentialAttestationHash, 32).reverse()
        );
        const attestationBEHex = `0x${beAttestationHashBytes.toHex()}`; // this does not have the 0x....
        console.log('attestationBEHex', attestationBEHex);

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
            credentialAttestationHash,
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

        const {
            depositAttestationProofJson,
            ethVerifierProofJson,
            despositSlotRaw,
        } = await firstValueFrom(
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
                    await depositAttestationWorkerReady;
                    console.log('Computing proofs...');
                    const {
                        depositAttestationProofJson,
                        ethVerifierProofJson,
                        despositSlotRaw,
                    } = await depositAttestation.computeAttestation(
                        depositBlockNumber,
                        ethAddressLowerHex,
                        attestationBEHex
                    );
                    depositAttestation.terminate();
                    return {
                        depositAttestationProofJson,
                        ethVerifierProofJson,
                        despositSlotRaw,
                    };
                })
            )
        );

        console.log(
            `bridge head [attestationHash] (BE hex):`,
            despositSlotRaw.slot_nested_key_attestation_hash
        );

        // Block until deposit has been processed
        console.log(
            'Waiting for deposit processing completion before we can complete the minting process.'
        );
        await lastValueFrom(depositProcessingStatus$);
        console.log('Deposit is processed unblocking mint process.');

        // COMPUTE PRESENTATION VERIFIER **************************************************

        await noriMinterReady;
        console.time('noriMinter.setupStorage');
        await noriMinter.setupStorage(minaPublicKey.toBase58());
        console.timeEnd('noriMinter.setupStorage');

        /*await mockVerifierReady;

        console.time('mockVerifier');
        await mockVerifier.verify(
            ethVerifierProofJson,
            depositAttestationProofJson,
            presentationJson,
            minaPrivateKey.toBase58(),
            zkAppPrivateKey.toBase58()
        );
        console.timeEnd('mockVerifier');*/

        console.time('Minting');
        //await noriMinter.mint(minaPublicKey.toBase58(), {ethDepositProofJson: })
        console.timeEnd('Minted');
        

        console.log('Minted!');
    }, 1000000000);
});
