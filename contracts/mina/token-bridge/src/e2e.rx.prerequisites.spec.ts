import { Bytes, Field, PrivateKey } from 'o1js';
import {
    compileEcdsaEthereum,
    compileEcdsaSigPresentationVerifier,
    createEcdsaMinaCredential,
    createEcdsaSigPresentation,
    createEcdsaSigPresentationRequest,
} from './credentialAttestation.js';
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
import { getBridgeSocket$, getReconnectingBridgeSocket$ } from './rx/socket.js';
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
    map,
    switchMap,
    take,
    tap,
} from 'rxjs';
import {
    BridgeDepositProcessingStatus,
    getDepositProcessingStatus$,
} from './rx/deposit.js';
import { computeDepositAttestation } from './depositAttestation.js';
import { fieldToBigIntLE, fieldToHexBE } from '@nori-zk/o1js-zk-utils';
import { TransitionNoticeMessageType } from '@nori-zk/pts-types';
import { signSecret } from './ethSignature.js';

describe('e2e_rx_prerequisites', () => {
    test('e2e_rx_pipeline', async () => {
        // Before we start we need, to compile pre requisites access to a wallet and an attested credential....

        // GET WALLET **************************************************
        const ethWallet = await getEthWallet();
        const ethAddressLowerHex = ethWallet.address.toLowerCase();

        // COMPILE E2E **************************************************

        // Compile what we need for E2E program (if we do this later it crashes???)
        await compilePreRequisites();

        // COMPILE ECDSA **************************************************
        console.time('compileEcdsaEthereum');
        await compileEcdsaEthereum();
        console.timeEnd('compileEcdsaEthereum'); // 1:20.330 (m:ss.mmm)

        console.time('compilePresentationVerifier');
        await compileEcdsaSigPresentationVerifier();
        console.timeEnd('compilePresentationVerifier'); // 11.507s

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

        // WALLET *******************
        // Create credential
        console.time('createCredential');
        const credentialJson = await createEcdsaMinaCredential(
            ethSecretSignature,
            ethWallet.address,
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
        //const credentialAttestationHash = Field.random();

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

        /*
{
  stageName: 'ProofConversionJobReceived',
  input_slot: 4817024,
  input_block_number: 4241469,
  output_slot: 4817088,
  output_block_number: 4241518,
  elapsed_sec: 328,
  time_remaining_sec: -6.846000000000004,
  deposit_processing_status: 'WaitingForCurrentJobCompletion',
  deposit_block_number: 4241490
}
{
  stageName: 'EthProcessorProofRequest',
  input_slot: 4817024,


        */
        const { depositAttestationProof, ethVerifierProof, despositSlotRaw } =
            await firstValueFrom(
                depositProcessingStatus$.pipe(
                    filter(
                        ({ deposit_processing_status, stageName }) =>
                            deposit_processing_status ===
                                BridgeDepositProcessingStatus.WaitingForCurrentJobCompletion &&
                            stageName ===
                                TransitionNoticeMessageType.ProofConversionJobSucceeded
                        //TransitionNoticeMessageType.EthProcessorProofRequest
                        //TransitionNoticeMessageType.ProofConversionJobSucceeded
                    ),
                    take(1),
                    switchMap(async () => {
                        console.log('Computing proofs...');
                        return await computeDepositAttestation(
                            depositBlockNumber,
                            ethAddressLowerHex,
                            attestationBEHex
                        );
                    })
                )
            );

        // Block until deposit has been processed
        console.log(
            'Waiting for deposit processing completion before we can complete the minting process.'
        );
        await lastValueFrom(depositProcessingStatus$);
        console.log('Deposit is processed unblocking mint process.');

        // COMPUTE E2E **************************************************

        console.log('Building e2e input');
        // Now the deposit has been processed we are free to compute the e2e proof.
        const e2ePrerequisitesInput = new E2ePrerequisitesInput({
            credentialAttestationHash,
        });

        console.log('Computing e2e');
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
