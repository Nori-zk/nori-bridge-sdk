import { Bytes, Field, PrivateKey } from 'o1js';
import {
    getEthWallet,
    getNewMinaLiteNetAccountSK,
    lockTokens,
    minaSetup,
} from './testUtils.js';
import { wordToBytes } from '@nori-zk/proof-conversion';
import {
    compilePreRequisites,
    deployAndVerifyEcdsaSigPresentationVerifier,
    MintPrerequisitesInput,
    MintPrerequisitesProgram,
} from './e2ePrerequisites.js';
import { getReconnectingBridgeSocket$ } from './rx/socket.js';
import {
    getBridgeStateTopic$,
    getBridgeTimingsTopic$,
    getEthStateTopic$,
} from './rx/topics.js';
import {
    audit,
    combineLatest,
    distinctUntilChanged,
    filter,
    firstValueFrom,
    interval,
    lastValueFrom,
    merge,
    switchMap,
    take,
    timer,
} from 'rxjs';
import {
    BridgeDepositProcessingStatus,
    getDepositProcessingStatus$,
} from './rx/deposit.js';
import {
    ContractDepositAttestorProof,
    EthProof,
    fieldToBigIntLE,
    fieldToHexBE,
} from '@nori-zk/o1js-zk-utils';
import { TransitionNoticeMessageType } from '@nori-zk/pts-types';
import { signSecret } from './ethSignature.js';
import { getDepositAttestation } from './workers/depositAttestation/node/parent.js';
import { getCredentialAttestation } from './workers/credentialAttestation/node/parent.js';
import {
    compileEcdsaEthereum,
    compileEcdsaSigPresentationVerifier,
    createEcdsaMinaCredential,
    createEcdsaSigPresentation,
    createEcdsaSigPresentationRequest,
} from './credentialAttestation.js';

describe('e2e-rx-workers', () => {
    test('e2e_rx_with_workers_pipeline', async () => {
        // Before we start we need, to compile pre requisites access to a wallet and an attested credential....

        // GET WALLET **************************************************
        const ethWallet = await getEthWallet();
        const ethAddressLowerHex = ethWallet.address.toLowerCase();

        // Init workers
        const depositAttestation = getDepositAttestation();
        const credentialAttestation = getCredentialAttestation();

        const depositAttestationWorkerReady = depositAttestation.compile();

        const credentialAttestationReady = credentialAttestation.compile();

        // COMPILE ECDSA

        // Compile programs / contracts
        console.time('compileEcdsaEthereum');
        await compileEcdsaEthereum();
        console.timeEnd('compileEcdsaEthereum'); // 1:20.330 (m:ss.mmm)

        console.time('compilePresentationVerifier');
        await compileEcdsaSigPresentationVerifier();
        console.timeEnd('compilePresentationVerifier'); // 11.507s

        // COMPILE E2E **************************************************

        // Compile what we need for E2E program
        await compilePreRequisites();

        // SETUP MINA **************************************************

        // Generate a funded test private key for mina litenet
        const litenetSk = await getNewMinaLiteNetAccountSK();
        const minaPrivateKey = PrivateKey.fromBase58(litenetSk);
        const minaPublicKey = minaPrivateKey.toPublicKey();

        // Generate a random zkAppAddress
        const zkAppPrivateKey = PrivateKey.random();
        const zkAppPublicKey = zkAppPrivateKey.toPublicKey();

        // OBTAIN CREDENTIAL **************************************************

        // CLIENT *******************
        const secret = 'IAmASecretOfLength20';
        // Get signature
        console.time('ethSecretSignature');
        const ethSecretSignature = await signSecret(secret, ethWallet);
        console.timeEnd('ethSecretSignature');

        console.log('ethSecretSignature', ethSecretSignature);
        console.log('minaPublicKey.toBase58()', minaPublicKey.toBase58());

        // WALLET *******************
        await credentialAttestationReady;
        // Create credential
        console.time('createCredential');
        const credentialJson = await credentialAttestation.computeCredential(
            secret,
            ethSecretSignature,
            ethWallet.address,
            minaPublicKey.toBase58()
        ); /*createEcdsaMinaCredential(
            ethSecretSignature,
            ethWallet.address,
            minaPublicKey,
            secret
        );*/
        console.timeEnd('createCredential'); // 2:02.513 (m:ss.mmm)

        // CLIENT *******************
        // Create a presentation request
        // This is sent from the client to the WALLET
        console.time('getPresentationRequest');
        const presentationRequestJson =
            await credentialAttestation.computeEcdsaSigPresentationRequest(
                zkAppPublicKey.toBase58()
            ); /* createEcdsaSigPresentationRequest(
            zkAppPublicKey
        );*/
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
            ); /*createEcdsaSigPresentation(
            presentationRequestJson,
            credentialJson,
            minaPrivateKey
        );*/
        console.timeEnd('getPresentation'); // 46.801s

        // Kill credentialAttestation worker
        credentialAttestation.terminate();

        // Extract hashed secret
        const presentation = JSON.parse(presentationJson);
        const messageHashString =
            presentation.outputClaim.value.messageHash.value;
        const messageHashBigInt = BigInt(messageHashString);
        const credentialAttestationHash = Field.from(messageHashBigInt);
        console.log('credentialAttestationHash from presentation.outputClaim.value.messageHash.value', credentialAttestationHash);

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

        merge(
            depositProcessingStatus$.pipe(
                distinctUntilChanged(
                    (a, b) =>
                        JSON.stringify(a.deposit_processing_status) ===
                        JSON.stringify(b.deposit_processing_status)
                )
            ),
            depositProcessingStatus$.pipe(audit(() => interval(60000)))
        ).subscribe({
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
                    //await depositAttestation.compile();
                    await depositAttestationWorkerReady;
                    console.log('Computing proofs...');
                    const {
                        depositAttestationProofJson,
                        ethVerifierProofJson,
                        despositSlotRaw,
                    } = await depositAttestation.compute(
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
        // Convert these: depositAttestationProofJson & ethVerifierProofJson back into proof objects
        const depositAttestationProof =
            await ContractDepositAttestorProof.fromJSON(
                depositAttestationProofJson
            );
        const ethVerifierProof = await EthProof.fromJSON(ethVerifierProofJson);

        // Block until deposit has been processed
        console.log(
            'Waiting for deposit processing completion before we can complete the minting process.'
        );
        await lastValueFrom(depositProcessingStatus$);
        console.log('Deposit is processed unblocking mint process.');

        // COMPUTE E2E **************************************************

        console.log('Building e2e input');
        // Now the deposit has been processed we are free to compute the e2e proof.
        const e2ePrerequisitesInput = new MintPrerequisitesInput({
            credentialAttestationHash,
        });

        console.log('Computing e2e');
        console.time('E2EPrerequisitesProgram.compute');
        const e2ePrerequisitesProof = await MintPrerequisitesProgram.compute(
            e2ePrerequisitesInput,
            ethVerifierProof,
            depositAttestationProof
        );
        console.timeEnd('E2EPrerequisitesProgram.compute');

        console.log('Computed E2EPrerequisitesProgram proof');

        const { totalLocked, storageDepositRoot, attestationHash } =
            e2ePrerequisitesProof.proof.publicOutput;

        console.log('attestationHash Field from e2ePrerequisitesProof.proof.publicOutput;', attestationHash);

        // Change these to asserts in future

        console.log('--- Decoded public output ---');
        console.log(
            `proved [totalLocked] (LE bigint): ${fieldToBigIntLE(totalLocked)}`
        );
        /*console.log(
            'bridge head [totalLocked] (BE bigint):',
            uint8ArrayToBigIntBE(hexStringToUint8Array(despositSlotRaw.value))
        );*/ // FIXME EXPORT THIS

        console.log(
            `proved [attestationHash] (BE hex): ${fieldToHexBE(
                attestationHash
            )}`
        );
        console.log(
            `bridge head [attestationHash] (BE hex):`,
            despositSlotRaw.slot_nested_key_attestation_hash
        );
        console.log(`original [attestationHash] (BE Hex):`, attestationBEHex);

        // Address

        console.log('original [address]:', ethAddressLowerHex);
        console.log('bridge head [address]:', despositSlotRaw.slot_key_address);

        // COMPUTE PRESENTATION VERIFIER **************************************************
        await minaSetup();

        console.time('deployAndVerifyEcdsaSigPresentationVerifier');
        await deployAndVerifyEcdsaSigPresentationVerifier(
            zkAppPrivateKey,
            minaPrivateKey,
            presentationJson
        );
        console.timeEnd('deployAndVerifyEcdsaSigPresentationVerifier');

        console.log('Minted!');
    }, 1000000000);
});
