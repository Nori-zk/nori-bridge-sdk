import { NetworkId, PrivateKey } from 'o1js';
import {
    getEthWallet,
    getNewMinaLiteNetAccountSK,
    lockTokens,
} from './testUtils.js';
import { getReconnectingBridgeSocket$ } from './rx/socket.js';
import {
    getBridgeStateTopic$,
    getBridgeTimingsTopic$,
    getEthStateTopic$,
} from './rx/topics.js';
import { Subscription } from 'rxjs';
import {
    bridgeStatusesKnownEnoughToLockUnsafe,
    canMint,
    getDepositProcessingStatus$,
    readyToComputeMintProof,
} from './rx/deposit.js';
import { signSecretWithEthWallet } from './ethSignature.js';
import { getSecretHashFromPresentationJson } from './credentialAttestationUtils.js';
import { TokenMintWorker } from './workers/tokenMint/node/parent.js';
import { TokenDeployerWorker } from './workers/tokenDeployer/node/parent.js';
import { CredentialAttestationWorker } from './workers/credentialAttestation/node/parent.js';

describe('e2e', () => {
    test('e2e_complete', async () => {
        let depositProcessingStatusSubscription: Subscription;
        try {
            // Define litenet mina config
            const minaConfig = {
                networkId: 'devnet' as NetworkId,
                mina: 'http://localhost:8080/graphql',
            };

            // INIT WORKERS **************************************************
            console.log('Fetching workers.');
            const tokenMintWorker = new TokenMintWorker();
            const credentialAttestationWorker =
                new CredentialAttestationWorker();

            // READY CREDENTIAL ATTESTATION WORKER **************************************
            console.log('Compiling credentialAttestationWorker dependancies.');
            const credentialAttestationReady =
                credentialAttestationWorker.compile();

            // DEPLOY TEST CONTRACTS **************************************************
            // Deploy token minter contracts (Note this will normally be done already for the user, this is just for testing)
            // Use the worker to be able to reclaim some ram
            console.log('Deploying contract.');
            const tokenDeployer = new TokenDeployerWorker();
            const storageInterfaceVerificationKeySafe: {
                data: string;
                hashStr: string;
            } = await tokenDeployer.compile();
            const contractsLitenetSk = await getNewMinaLiteNetAccountSK();
            const contractSenderPrivateKey =
                PrivateKey.fromBase58(contractsLitenetSk);
            const contractSenderPrivateKeyBase58 =
                contractSenderPrivateKey.toBase58();
            const tokenControllerPrivateKey = PrivateKey.random();
            const tokenBasePrivateKey = PrivateKey.random();
            const ethProcessorAddress = PrivateKey.random()
                .toPublicKey()
                .toBase58();
            console.log('Eth processor address', ethProcessorAddress);
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

            // Generate a funded test private key for mina litenet
            const litenetSk = await getNewMinaLiteNetAccountSK();
            const senderPrivateKey = PrivateKey.fromBase58(litenetSk);
            const senderPrivateKeyBase58 = senderPrivateKey.toBase58();
            console.log('senderPrivateKey.toPublickKey',senderPrivateKey);
            const senderPublicKey = senderPrivateKey.toPublicKey();
            const senderPublicKeyBase58 = senderPublicKey.toBase58();

            // START MAIN FLOW

            // GET WALLET **************************************************
            console.log('Getting ETH wallet.');
            const ethWallet = await getEthWallet();
            const ethAddressLowerHex = ethWallet.address.toLowerCase();

            // OBTAIN CREDENTIAL **************************************************

            // CLIENT *******************
            const secret = 'IAmASecretOfLength20';
            // Get signature
            console.log('Creating eth signature of our secret');
            console.time('ethSecretSignature');
            const ethSecretSignature = await signSecretWithEthWallet(
                secret,
                ethWallet
            );
            console.timeEnd('ethSecretSignature');

            // These prints are just for testing purposes.
            console.log('ethSecretSignature', ethSecretSignature);
            console.log('senderPrivateKey.toBase58()', senderPrivateKeyBase58);
            console.log('senderPublicKey.toBase58()', senderPublicKeyBase58);

            // CLIENT *******************
            console.log('Awaiting credentialAttestation compile.');
            await credentialAttestationReady;
            // Create credential
            console.log('Creating credential');
            console.time('createCredential');
            // This would be sent from the CLIENT to the WALLET to store.
            const credentialJson =
                await credentialAttestationWorker.computeCredential(
                    secret,
                    ethSecretSignature,
                    ethWallet.address,
                    senderPublicKeyBase58
                );
            console.timeEnd('createCredential'); // 2:02.513 (m:ss.mmm)

            // CLIENT *******************
            // Create a presentation request
            // This is sent from the CLIENT to the WALLET
            console.log('Creating presentation request');
            console.time('getPresentationRequest');
            const presentationRequestJson =
                await credentialAttestationWorker.computeEcdsaSigPresentationRequest(
                    noriTokenControllerAddressBase58
                );
            console.timeEnd('getPresentationRequest'); // 1.348ms

            // WALLET ********************
            // WALLET takes a presentation request and the WALLET can retrieve the stored credential
            // From this it creates a presentation and sends this to the CLIENT
            console.time('getPresentation');
            console.log('Creating presentation');
            const presentationJsonStr =
                await credentialAttestationWorker.WALLET_computeEcdsaSigPresentation(
                    presentationRequestJson,
                    credentialJson,
                    senderPrivateKeyBase58
                );
            console.timeEnd('getPresentation'); // 46.801s

            // Kill credentialAttestation worker to reclaim ram.
            credentialAttestationWorker.terminate();
            console.log('credentialAttestationWorker terminated');

            // CLIENT only logic from now on....

            // Extract hashed secret from presentation
            const {
                credentialAttestationBEHex,
                credentialAttestationHashField,
            } = getSecretHashFromPresentationJson(presentationJsonStr);
            console.log('attestationBEHex', credentialAttestationBEHex);

            // CONNECT TO BRIDGE **************************************************

            // Establish a connection to the bridge.
            console.log('Establishing bridge connection and topics.');
            const { bridgeSocket$, bridgeSocketConnectionState$ } =
                getReconnectingBridgeSocket$();

            // Subscribe to the sockets connection status.
            bridgeSocketConnectionState$.subscribe({
                next: (state) => console.log(`[WS] ${state}`),
                error: (state) => console.error(`[WS] ${state}`),
                complete: () =>
                    console.log('[WS] Bridge socket connection completed.'),
            });

            // Retrieve observables for the bridge topics needed.
            const ethStateTopic$ = getEthStateTopic$(bridgeSocket$);
            const bridgeStateTopic$ = getBridgeStateTopic$(bridgeSocket$);
            const bridgeTimingsTopic$ = getBridgeTimingsTopic$(bridgeSocket$);

            // Wait for bridge topics to be ready, to ensure correct deposit classification.
            // Under normal conditions this is very fast. But see the docstring for why this
            // may be unsafe, a safe method is also provided.
            console.log('Awaiting sufficient bridge state');
            console.time('bridgeStateReady');
            await bridgeStatusesKnownEnoughToLockUnsafe(
                ethStateTopic$,
                bridgeStateTopic$,
                bridgeTimingsTopic$
            );
            console.timeEnd('bridgeStateReady');

            // LOCK TOKENS **************************************************

            console.log('Locking eth tokens');
            console.time('lockingTokens');
            const depositAmount = 0.000001;
            console.log('Deposit amount', depositAmount);
            const depositBlockNumber = await lockTokens(
                credentialAttestationHashField,
                depositAmount
            );
            console.timeEnd('lockingTokens');

            // ESTABLISH DEPOSIT BRIDGE PROCESSING STATUS **********************************

            // Get deposit status given our execution block number from the tx receipt.
            const depositProcessingStatus$ = getDepositProcessingStatus$(
                depositBlockNumber,
                ethStateTopic$,
                bridgeStateTopic$,
                bridgeTimingsTopic$
            );

            // Subscribe to the depositProcessingStatus observable to print our progress.
            depositProcessingStatusSubscription =
                depositProcessingStatus$.subscribe({
                    next: console.log,
                    error: console.error,
                    complete: () =>
                        console.warn(
                            'Deposit processing completed. Mint opportunity has been missed :('
                        ),
                });

            // COMPUTE DEPOSIT ATTESTATION **************************************************

            // Compile tokenMintWorker dependancies
            console.log('Compiling dependancies of tokenMintWorker');
            const tokenMintWorkerReady = tokenMintWorker.compileAll();

            // Block until we can compute our deposit attestation proof.
            console.log(
                'Waiting for ProofConversionJobSucceeded on WaitingForCurrentJobCompletion before we can compute our EthDeposit proof.'
            );

            // Throws if we have missed our minting opportunity
            await readyToComputeMintProof(depositProcessingStatus$);

            console.log('Computing eth deposit proof.');
            const { ethDepositProofJson, despositSlotRaw } =
                await tokenMintWorker.computeEthDeposit(
                    presentationJsonStr,
                    depositBlockNumber,
                    ethAddressLowerHex
                );

            console.log(
                `bridge head [attestationHash] (BE hex):`,
                despositSlotRaw.slot_nested_key_attestation_hash
            );

            // WAIT FOR DEPOSIT PROCESSING COMPLETED BY BRIDGE ***************************

            console.log(
                'Waiting for deposit processing completion before we can complete the minting process.'
            );
            // Block until deposit has been processed (when the depositProcessingStatus$ observable completes)
            // Throws if we have missed our minting opportunity
            await canMint(depositProcessingStatus$);
            console.log('Deposit is processed unblocking mint process.');

            // PREPARE FOR MINTING **************************************************

            // Configure wallet
            // In reality we would not pass this from the main thread. We would rely on the WALLET for signatures.
            await tokenMintWorker.WALLET_setMinaPrivateKey(
                senderPrivateKeyBase58
            );
            await tokenMintWorker.minaSetup(minaConfig);

            // Get noriTokenControllerVerificationKeySafe from tokenMintWorkerReady resolution.
            const noriTokenControllerVerificationKeySafe =
                await tokenMintWorkerReady;
            console.log('Awaited compilation of tokenMintWorkerReady');

            // SETUP STORAGE **************************************************

            console.time('noriMinter.setupStorage');
            const { txHash: setupTxHash } =
                await tokenMintWorker.MOCK_setupStorage(
                    senderPublicKeyBase58,
                    noriTokenControllerAddressBase58,
                    0.1 * 1e9,
                    noriTokenControllerVerificationKeySafe
                );

            // NOTE! ************
            // Really a client would use await tokenMintWorker.setupStorage(...args) and get a provedSetupTxStr which would be submitted to the WALLET for signing
            // Currently we don't have the correct logic for emulating the wallet signAndSend method. However tokenMintWorker.setupStorage should be used on the
            // frontend.
            /*const provedSetupTxStr = await tokenMintWorker.setupStorage(
                senderPublicKeyBase58,
                noriTokenControllerAddressBase58,
                0.1 * 1e9,
                noriTokenControllerVerificationKeySafe
            );
            console.log('provedSetupTxStr', provedSetupTxStr);*/
            // MOCK for wallet behaviour
            /*const { txHash: setupTxHash } =
            await tokenMintWorker.WALLET_signAndSend(provedSetupTxStr);*/

            console.log('setupTxHash', setupTxHash);
            console.timeEnd('noriMinter.setupStorage');

            // MINT **************************************************

            console.log('Determining user funding status.');
            const needsToFundAccount = await tokenMintWorker.needsToFundAccount(
                tokenBaseAddressBase58,
                senderPublicKeyBase58
            );
            console.log('needsToFundAccount', needsToFundAccount);

            console.time('Minting');
            const { txHash: mintTxHash } = await tokenMintWorker.MOCK_mint(
                senderPublicKeyBase58,
                noriTokenControllerAddressBase58,
                {
                    ethDepositProofJson: ethDepositProofJson,
                    presentationProofStr: presentationJsonStr,
                },
                1e9 * 0.1,
                needsToFundAccount // needsToFundAccount should resolve to be true for this test.
            );

            // NOTE! ************
            // Really a client would use await tokenMintWorker.mint(...args) and get a provedMintTxStr which would be submitted to the WALLET for signing
            // Currently we don't have the correct logic for emulating the wallet signAndSend method. However tokenMintWorker.mint should be used on the
            // frontend.
            /*const provedMintTxStr = await tokenMintWorker.mint(
                senderPublicKeyBase58,
                noriTokenControllerAddressBase58, // CHECKME @Karol
                {
                    ethDepositProofJson: ethDepositProofJson,
                    presentationProofStr: presentationJsonStr,
                },
                1e9 * 0.1,
                true
            );
            console.log('provedMintTxStr', provedMintTxStr);*/
            // MOCK for wallet behaviour
            /*const { txHash: mintTxHash } =
            await tokenMintWorker.WALLET_signAndSend(provedMintTxStr);*/

            console.log('mintTxHash', mintTxHash);
            console.timeEnd('Minted');
            console.log('Minted!');

            // Get the amount minted so far and print it
            const mintedSoFar = await tokenMintWorker.mintedSoFar(
                noriTokenControllerAddressBase58,
                senderPublicKeyBase58
            );
            console.log('mintedSoFar', mintedSoFar);

            const balanceOfUser = await tokenMintWorker.getBalanceOf(
                tokenBaseAddressBase58,
                senderPublicKeyBase58
            );
            console.log('balanceOfUser', balanceOfUser);

            // END MAIN FLOW
        }
        catch(e: unknown) {
            const error = e as Error;
            console.error(error.stack);
            throw e;
        }
        finally {
            if (depositProcessingStatusSubscription)
                depositProcessingStatusSubscription.unsubscribe();
        }
    }, 1000000000);
});
