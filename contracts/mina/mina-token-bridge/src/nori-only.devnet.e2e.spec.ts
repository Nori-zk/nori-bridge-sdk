import 'dotenv/config';
import { Logger, LogPrinter } from 'esm-iso-logger';
import { type NetworkId, PrivateKey } from 'o1js';
import { getReconnectingBridgeSocket$ } from './rx/socket.js';
import {
    getBridgeStateTopic$,
    getBridgeTimingsTopic$,
    getEthStateTopic$,
} from './rx/topics.js';
import { type Subscription } from 'rxjs';
import {
    bridgeStatusesKnownEnoughToLockUnsafe,
    canMint,
    getDepositProcessingStatus$,
    readyToComputeMintProof,
} from './rx/deposit.js';
import { signSecretWithEthWallet } from './ethSignature.js';
import { getZkAppWorker } from './workers/zkAppWorker/node/parent.js';
import { type BigNumberish, ethers, type TransactionResponse } from 'ethers';
import { noriTokenBridgeJson } from '@nori-zk/ethereum-token-bridge';
import {
    createCodeChallenge,
    obtainCodeVerifierFromEthSignature,
} from './pkarm.js';
import { validateEnv } from './testUtils.js';
import { createTimer } from '@nori-zk/o1js-zk-utils';

// https://faucet.minaprotocol.com/

new LogPrinter('TestTokenBridge');
const logger = new Logger('E2EDevnetSpec');

describe('e2e_testnet', () => {

    test('e2e_complete_testnet', async () => {
        let depositProcessingStatusSubscription: Subscription;
        try {
            // Get ENV VARS
            const {
                ethPrivateKey,
                ethRpcUrl,
                noriETHBridgeAddressHex,
                noriTokenBridgeAddressBase58,
                minaRpcUrl,
                minaSenderPrivateKeyBase58,
                noriTokenBaseAddressBase58,
            } = validateEnv();

            const minaSenderPrivateKey = PrivateKey.fromBase58(
                minaSenderPrivateKeyBase58
            );
            const minaSenderPublicKey = minaSenderPrivateKey.toPublicKey();
            const minaSenderPublicKeyBase58 = minaSenderPublicKey.toBase58();

            // Define litenet mina config
            const minaConfig = {
                networkId: 'testnet' as NetworkId,
                mina: minaRpcUrl,
            };

            // GET ETH WALLET **************************************************
            logger.log('Getting ETH wallet.');
            const etherProvider = new ethers.JsonRpcProvider(ethRpcUrl);
            const ethWallet = new ethers.Wallet(ethPrivateKey, etherProvider);
            const ethAddressLowerHex = ethWallet.address.toLowerCase();

            // START MAIN FLOW

            // OBTAIN CREDENTIAL **************************************************

            // CLIENT *******************

            // Note this value is used to restrict the domain of the signature but could
            // also be a user provided secret for extra security.
            const fixedValueOrSecret = 'NoriZK25';
            // Get signature secret, this is used simply used such that we can deterministically
            // derive our secret used for the PKARM code exchange without the user having to store
            // any secret, when a fixed field is used.
            // If the user uses a fixed value then they could use their eth wallet to re generate
            // their codeVerifier (secret) on another machine.
            // If they provided a secret then they would have to keep this themselves and provide it when minting.
            logger.log('Creating eth signature of our secret / fixed field');
            const ethSignatureSecretTimer = createTimer();
            const ethSignatureSecret = await signSecretWithEthWallet(
                fixedValueOrSecret,
                ethWallet
            );
            logger.log(`Eth signature secret computed in ${ethSignatureSecretTimer()}`);

            // These prints are just for testing purposes.
            logger.log('ethSignatureSecret', ethSignatureSecret);
            logger.log(
                'senderPublicKey.toBase58()',
                minaSenderPublicKeyBase58
            );

            // CLIENT only logic from now on....

            // Generate PKARM code challenge from signature and mina public key
            const codeVerifierPKARMField =
                obtainCodeVerifierFromEthSignature(ethSignatureSecret); // This is a secret field
            const codeVerifierPKARMBigInt = codeVerifierPKARMField.toBigInt();
            const codeVerifierPKARMStr = codeVerifierPKARMBigInt.toString();

            const codeChallengePKARMField = createCodeChallenge(
                codeVerifierPKARMField,
                minaSenderPublicKey
            ); // This is the code challenge witness which can be stored publically (on chain)
            const codeChallengePKARMBigInt = codeChallengePKARMField.toBigInt();
            const codeChallengePKARMStr = codeChallengePKARMBigInt.toString();

            logger.log('ethSignatureSecret', ethSignatureSecret);
            logger.log(
                'senderPublicKey.toBase58()',
                minaSenderPublicKeyBase58
            );
            logger.log(
                'senderPrivateKey.toBase58()',
                minaSenderPrivateKeyBase58
            );
            logger.log('codeVerifierPKARMField', codeVerifierPKARMField);
            logger.log('codeVerifierPKARMBigInt', codeVerifierPKARMBigInt);
            logger.log('codeVerifierPKARMStr', codeVerifierPKARMStr);
            logger.log('codeChallengePKARMBigInt', codeChallengePKARMBigInt);
            logger.log('codeChallengePKARMStr', codeChallengePKARMStr);

            // CONNECT TO BRIDGE **************************************************

            // Establish a connection to the bridge.
            logger.log('Establishing bridge connection and topics.');
            const { bridgeSocket$, bridgeSocketConnectionState$ } =
                getReconnectingBridgeSocket$();

            // Subscribe to the sockets connection status.
            bridgeSocketConnectionState$.subscribe({
                next: (state) => logger.log(`[WS] ${state}`),
                error: (state) => logger.error(`[WS] ${state}`),
                complete: () =>
                    logger.log('[WS] Bridge socket connection completed.'),
            });

            // Retrieve observables for the bridge topics needed.
            const ethStateTopic$ = getEthStateTopic$(bridgeSocket$);
            const bridgeStateTopic$ = getBridgeStateTopic$(bridgeSocket$);
            const bridgeTimingsTopic$ = getBridgeTimingsTopic$(bridgeSocket$);

            // Wait for bridge topics to be ready, to ensure correct deposit classification.
            // Under normal conditions this is very fast. But see the docstring for why this
            // may be unsafe, a safe method is also provided.
            logger.log('Awaiting sufficient bridge state');
            const bridgeStateReadyTimer = createTimer();
            await bridgeStatusesKnownEnoughToLockUnsafe(
                ethStateTopic$,
                bridgeStateTopic$,
                bridgeTimingsTopic$
            );
            logger.log(`Bridge state ready in ${bridgeStateReadyTimer()}`);

            // LOCK TOKENS **************************************************

            logger.log('Locking eth tokens');
            const lockingTokensTimer = createTimer();
            const abi = noriTokenBridgeJson.abi;
            const contract = new ethers.Contract(
                noriETHBridgeAddressHex,
                abi,
                ethWallet
            );
            const credentialAttestationBigNumberIsh: BigNumberish =
                codeChallengePKARMBigInt;
            const depositAmountStr = '0.000001';
            logger.log('depositAmountStr', depositAmountStr);
            const depositAmount = ethers.parseEther(depositAmountStr);
            const result: TransactionResponse = await contract.lockTokens(
                credentialAttestationBigNumberIsh,
                { value: depositAmount }
            );
            logger.log('Eth deposit made', result);
            logger.log('Waiting for 1 confirmation');
            const confirmedResult = await result.wait();
            logger.log('Confirmed Eth Deposit', confirmedResult);
            const depositBlockNumber = confirmedResult.blockNumber;
            if (!depositBlockNumber) {
                logger.error('depositBlockNumber was falsey');
            }
            logger.log(
                `Deposit confirmed with blockNumber: ${depositBlockNumber}`
            );
            logger.log(`Tokens locked in ${lockingTokensTimer()}`);

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
                    next: (msg) => logger.log(msg),
                    error: (err) => logger.error(err),
                    complete: () =>
                        logger.warn(
                            'Deposit processing completed. Mint opportunity has been missed :('
                        ),
                });

            // COMPUTE DEPOSIT ATTESTATION **************************************************

            // INIT WORKER **************************************************
            logger.log('Fetching zkApp worker.');
            const ZkAppWorker = getZkAppWorker();

            // Compile zkAppWorker dependancies
            logger.log('Compiling dependancies of zkAppWorker');
            const zkAppWorker = new ZkAppWorker();
            const zkAppWorkerReady = zkAppWorker.compileAll(); // ?? Can we move this earlier...

            // PREPARE FOR MINTING **************************************************

            // Configure wallet
            // In reality we would not pass this from the main thread. We would rely on the WALLET for signatures.
            await zkAppWorker.WALLET_setMinaPrivateKey(
                minaSenderPrivateKeyBase58
            );
            await zkAppWorker.minaSetup(minaConfig);

            // Get noriStorageInterfaceVerificationKeySafe from zkAppWorkerReady resolution.
            const { noriStorageInterfaceVerificationKeySafe } =
                await zkAppWorkerReady;
            logger.log('Awaited compilation of zkAppWorkerReady');

            // SETUP STORAGE **************************************************
            // TODO IMPROVE THIS
            const setupRequired = await zkAppWorker.needsToSetupStorage(
                noriTokenBridgeAddressBase58,
                minaSenderPublicKeyBase58
            );

            logger.log(`Setup storage required? '${setupRequired}'`);
            if (setupRequired) {
                logger.log('Setting up storage');
                const setupStorageTimer = createTimer();
                const { txHash: setupTxHash } =
                    await zkAppWorker.MOCK_setupStorage(
                        minaSenderPublicKeyBase58,
                        noriTokenBridgeAddressBase58,
                        0.1 * 1e9,
                        noriStorageInterfaceVerificationKeySafe
                    );
                // NOTE! ************
                // Really a client would use await zkAppWorker.setupStorage(...args) and get a provedSetupTxStr which would be submitted to the WALLET for signing
                // Currently we don't have the correct logic for emulating the wallet signAndSend method. However zkAppWorker.setupStorage should be used on the
                // frontend.
                /*const provedSetupTxStr = await zkAppWorker.setupStorage(
                    senderPublicKeyBase58,
                    noriTokenBridgeAddressBase58,
                    0.1 * 1e9,
                    noriStorageInterfaceVerificationKeySafe
                );
                logger.log('provedSetupTxStr', provedSetupTxStr);*/
                // The below should use a real wallets signAndSend method.
                /*const { txHash: setupTxHash } =
                await zkAppWorker.WALLET_signAndSend(provedSetupTxStr);*/

                logger.log('setupTxHash', setupTxHash);
                logger.log(`Nori minter storage setup in ${setupStorageTimer()}`);
            }

            // Block until we can compute our deposit attestation proof.
            logger.log(
                'Waiting for ProofConversionJobSucceeded on WaitingForCurrentJobCompletion before we can compute our EthDeposit proof.'
            );

            // Waits for proof conversion to be finished.
            // Throws if we have missed our minting opportunity.
            await readyToComputeMintProof(depositProcessingStatus$);

            // Compute eth verifier and deposit witness
            logger.log(
                'Computing eth verifier and calculating deposit witness.'
            );
            const { depositAttestationInput } =
                await zkAppWorker.computeDepositAttestationWitnessAndEthVerifier(
                    codeChallengePKARMStr,
                    depositBlockNumber,
                    ethAddressLowerHex
                );
            logger.log(
                'Computed eth verifier and calculated deposit witness.'
            );

            // PRE-COMPUTE MINT PROOF ****************************************************

            logger.log('Determining user funding status.');
            const needsToFundAccount = await zkAppWorker.needsToFundAccount(
                noriTokenBaseAddressBase58,
                minaSenderPublicKeyBase58
            );
            logger.log('needsToFundAccount', needsToFundAccount);

            logger.log('Computing mint proof.');

            const mintProofComputationTimer = createTimer();
            await zkAppWorker.MOCK_computeMintProofAndCache(
                minaSenderPublicKeyBase58,
                noriTokenBridgeAddressBase58,
                depositAttestationInput,
                codeVerifierPKARMStr,
                1e9 * 0.1,
                needsToFundAccount
            );
            logger.log(`Mint proof computation in ${mintProofComputationTimer()}`);
            // NOTE!
            // Really a client would use await zkAppWorker.mint(...args) and get a provedMintTxStr which would be submitted to the WALLET for signing
            // Currently we don't have the correct logic for emulating the wallet signAndSend method. However zkAppWorker.mint should be used on the
            // frontend, and at this stage, instead of the above:
            /*const provedMintTxStr = await zkAppWorker.mint(
                senderPublicKeyBase58,
                noriTokenBridgeAddressBase58, // CHECKME @Karol
                {
                    ethDepositProofJson: ethDepositProofJson,
                    presentationProofStr: presentationJsonStr,
                },
                1e9 * 0.1,
                true
            );
            logger.log('provedMintTxStr', provedMintTxStr);*/

            // WAIT FOR DEPOSIT PROCESSING COMPLETED BY BRIDGE BEFORE SENDING OUR MINT PROOF TO MINA **********************

            logger.log(
                'Waiting for deposit processing completion before we can sign and send the mint proof.'
            );

            // Block until deposit has been processed (when the depositProcessingStatus$ observable completes)
            // Throws if we have missed our minting opportunity
            await canMint(depositProcessingStatus$);
            logger.log(
                'Deposit is processed signing and sending the mint proof.'
            );

            // SIGN AND SEND MINT PROOF **************************************************

            const mintTransactionFinalizedTimer = createTimer();
            const { txHash: mintTxHash } =
                await zkAppWorker.WALLET_MOCK_signAndSendMintProofCache();
            // Note a client would really use a wallet.signAndSend(provedMintTxStr) method at this point instead of the above.
            // And ideally when WALLET_signAndSend works properly we would replace the above(within this test only!) with the below MOCK for wallet behaviour.
            /*const { txHash: mintTxHash } =
            await zkAppWorker.WALLET_signAndSend(provedMintTxStr);*/
            logger.log('mintTxHash', mintTxHash);
            logger.log(`Mint transaction finalized in ${mintTransactionFinalizedTimer()}`);
            logger.log('Minted!');

            // Get the amount minted so far and print it
            const mintedSoFar = await zkAppWorker.mintedSoFar(
                noriTokenBridgeAddressBase58,
                minaSenderPublicKeyBase58
            );
            logger.log('mintedSoFar', mintedSoFar);

            const balanceOfUser = await zkAppWorker.getBalanceOf(
                noriTokenBaseAddressBase58,
                minaSenderPublicKeyBase58
            );
            logger.log('balanceOfUser', balanceOfUser);

            // END MAIN FLOW
        } finally {
            if (depositProcessingStatusSubscription)
                depositProcessingStatusSubscription.unsubscribe();
        }
    }, 1000000000);
});
