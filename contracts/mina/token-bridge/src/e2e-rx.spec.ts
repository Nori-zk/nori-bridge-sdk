import { Bytes, Field, PrivateKey } from 'o1js';
import {
    compileEcdsaEthereum,
    compileEcdsaSigPresentationVerifier,
    createEcdsaMinaCredential,
    createEcdsaSigPresentation,
    createEcdsaSigPresentationRequest,
} from './attestation.js';
import {
    getEthWallet,
    getNewMinaLiteNetAccountSK,
    lockTokens,
} from './testUtils.js';
import { wordToBytes } from '@nori-zk/proof-conversion';
import {
    compilePreRequisites,
    deployAndVerifyEcdsaSigPresentationVerifier,
    E2ePrerequisitesInput,
    E2EPrerequisitesProgram,
} from './e2ePrerequisites.js';
import { getBridgeSocket$ } from './rx/bridge/socket.js';
import { getEthStateTopic$ } from './rx/eth/topic.js';
import {
    getBridgeStateTopic$,
    getBridgeTimingsTopic$,
} from './rx/bridge/topics.js';
import {
    combineLatest,
    filter,
    firstValueFrom,
    lastValueFrom,
    map,
    take,
    tap,
} from 'rxjs';
import {
    BridgeDepositProcessingStatus,
    getDepositProcessingStatus$,
} from './rx/bridge/deposit.js';
import { fetchContractWindowProofsSlotsAndCompute } from './computeProofs.js';
import { fieldToBigIntLE, fieldToHexBE } from '@nori-zk/o1js-zk-utils';
import { TransitionNoticeMessageType } from '@nori-zk/pts-types/build/public/src/index.js';

describe('e2e-rx', () => {
    test('e2e_rx_pipeline', async () => {
        // Before we start we need, to compile pre requisites access to a wallet and an attested credential....

        // COMPILE ECDSA **************************************************
        console.time('compileEcdsaEthereum');
        await compileEcdsaEthereum();
        console.timeEnd('compileEcdsaEthereum'); // 1:20.330 (m:ss.mmm)

        console.time('compilePresentationVerifier');
        await compileEcdsaSigPresentationVerifier();
        console.timeEnd('compilePresentationVerifier'); // 11.507s

        // GET WALLET **************************************************
        const ethWallet = await getEthWallet();
        const ethAddressLowerHex = ethWallet.address.toLowerCase();

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
        // Create a credential and we send this to the WALLET to store it....
        const secret = 'IAmASecretOfLength20';
        console.time('createCredential');
        const { credentialJson } = await createEcdsaMinaCredential(
            ethWallet,
            minaPublicKey,
            secret
        );
        console.timeEnd('createCredential'); // 2:02.513 (m:ss.mmm)

        // CLIENT *******************
        // Create a presentation request
        // This is sent from the client to the WALLET
        console.time('getPresentationRequest');
        const presentationRequestJson = await createEcdsaSigPresentationRequest(
            zkAppPublicKey
        );
        console.timeEnd('getPresentationRequest'); // 1.348ms

        // WALLET ********************
        // WALLET takes a presentation request and the WALLET can retrieve the stored credential
        // From this it creates a presentation.
        console.time('getPresentation');
        const presentationJson = await createEcdsaSigPresentation(
            presentationRequestJson,
            credentialJson,
            minaPrivateKey
        );
        console.timeEnd('getPresentation'); // 46.801s

        // Extract hashed secret
        const presentation = JSON.parse(presentationJson);
        const messageHashString =
            presentation.outputClaim.value.messageHash.value;
        const messageHashBigInt = BigInt(messageHashString);
        const credentialAttestationHash = Field.from(messageHashBigInt);

        const beAttestationHashBytes = Bytes.from(
            wordToBytes(credentialAttestationHash, 32).reverse()
        );
        const attestationBEHex = `0x${beAttestationHashBytes.toHex()}`; // this does not have the 0x....
        console.log('attestationBEHex', attestationBEHex);

        // CONNECT TO BRIDGE **************************************************

        // Establish a connection to the bridge.
        const bridgeSocket$ = getBridgeSocket$();
        const ethStateTopic$ = getEthStateTopic$(bridgeSocket$);
        const bridgeStateTopic$ = getBridgeStateTopic$(bridgeSocket$);
        const bridgeTimingsTopic$ = getBridgeTimingsTopic$(bridgeSocket$);

        // Wait for bridge topics to be ready.
        const topicsReady$ = combineLatest([
            ethStateTopic$,
            bridgeStateTopic$,
            bridgeTimingsTopic$,
        ]).pipe(
            take(1),
            map(() => true)
        );
        await firstValueFrom(topicsReady$);

        // COMPILE E2E **************************************************

        // Compile what we need for E2E program
        await compilePreRequisites();

        // LOCK TOKENS **************************************************

        console.log('Locking tokens');
        const depositBlockNumber = await lockTokens(
            credentialAttestationHash,
            0.000001
        );
        console.log('Locked tokens');

        // WAIT FOR BRIDGE PROCESSING **************************************************

        // Get deposit status.
        const depositProcessingStatus$ = getDepositProcessingStatus$(
            depositBlockNumber,
            ethStateTopic$,
            bridgeStateTopic$,
            bridgeTimingsTopic$
        );

        const depositProcessingSub = depositProcessingStatus$.subscribe(
            console.log
        );

        // Compute proof
        const { depositAttestationProof, ethVerifierProof, despositSlotRaw } =
            await firstValueFrom(
                depositProcessingStatus$.pipe(
                    filter(
                        ({ deposit_processing_status, stageName }) =>
                            deposit_processing_status ===
                                BridgeDepositProcessingStatus.WaitingForCurrentJobCompletion &&
                            stageName ===
                                TransitionNoticeMessageType.ProofConversionJobSucceeded
                    ),
                    take(1),
                    map(async () => {
                        return await fetchContractWindowProofsSlotsAndCompute(
                            depositBlockNumber,
                            ethAddressLowerHex,
                            attestationBEHex
                        );
                    })
                )
            );

        // Block until deposit has been processed
        await lastValueFrom(depositProcessingStatus$);

        // End depositProcessingStatus$ printing subscription
        depositProcessingSub.unsubscribe();

        // COMPUTE E2E **************************************************

        // Now the deposit has been processed we are free to compute the e2e proof.
        const e2ePrerequisitesInput = new E2ePrerequisitesInput({
            credentialAttestationHash,
        });

        console.time('E2EPrerequisitesProgram.compute');
        const e2ePrerequisitesProof = await E2EPrerequisitesProgram.compute(
            e2ePrerequisitesInput,
            ethVerifierProof,
            depositAttestationProof
        );
        console.timeEnd('E2EPrerequisitesProgram.compute');

        console.log('Computed E2EPrerequisitesProgram proof');

        const { totalLocked, storageDepositRoot, attestationHash } =
            e2ePrerequisitesProof.proof.publicOutput;

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

        await deployAndVerifyEcdsaSigPresentationVerifier(
            zkAppPrivateKey,
            minaPrivateKey,
            presentationJson
        );

        console.log('Minted!');
    }, 1000000000);
});
