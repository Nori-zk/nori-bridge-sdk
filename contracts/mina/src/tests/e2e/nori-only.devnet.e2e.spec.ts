import 'dotenv/config';
import { Logger, LogPrinter } from 'esm-iso-logger';
import { PrivateKey } from 'o1js';
import { getReconnectingBridgeSocket$ } from '../../rx/socket.js';
import {
    getBridgeStateTopic$,
    getBridgeTimingsTopic$,
    getEthStateTopic$,
} from '../../rx/topics.js';
import { type Subscription } from 'rxjs';
import {
    bridgeStatusesKnownEnoughToLockUnsafe,
    canMint,
    getDepositProcessingStatus$,
    readyToComputeMintProof,
} from '../../rx/deposit.js';
import { getTokenBridgeWorker } from '../../workers/tokenBridgeWorker/node/parent.js';
import { type BigNumberish, ethers, type TransactionResponse } from 'ethers';
import { noriTokenBridgeJson as noriEthTokenBridgeJson } from '@nori-zk/ethereum-token-bridge';
import { getStagingEnv, validateEnv } from '../testUtils.js';
import { createTimer } from '@nori-zk/o1js-zk-utils';

// https://faucet.minaprotocol.com/

new LogPrinter('TestTokenBridge');
const logger = new Logger('E2EDevnetSpec');

const {
    NORI_ETH_TOKEN_BRIDGE_ADDRESS: noriETHBridgeAddressHex,
    NORI_MINA_TOKEN_BRIDGE_ADDRESS: noriTokenBridgeAddressBase58,
    NORI_MINA_TOKEN_BASE_ADDRESS: noriTokenBaseAddressBase58,
    MINA_RPC_NETWORK_URL: minaRpcUrl,
    MINA_ARCHIVE_RPC_URL: minaArchiveRpcUrl,
    MINA_RPC_NETWORK_ID: minaRpcNetworkId,
    NORI_WSS_URL: noriWssUrl,
    NORI_PCS_URL: noriPcsUrl,
} = getStagingEnv();

describe('e2e_testnet', () => {

    const minaConfig = {
        networkId: minaRpcNetworkId,
        mina: minaRpcUrl,
        archive: minaArchiveRpcUrl,
    };

    test('e2e_complete_testnet', async () => {
        let depositProcessingStatusSubscription: Subscription;
        try {
            // Get ENV VARS
            const {
                ethPrivateKey,
                ethRpcUrl,
                minaSenderPrivateKeyBase58,
            } = validateEnv();

            const minaSenderPrivateKey = PrivateKey.fromBase58(
                minaSenderPrivateKeyBase58
            );
            const minaSenderPublicKey = minaSenderPrivateKey.toPublicKey();
            const minaSenderPublicKeyBase58 = minaSenderPublicKey.toBase58();

            // GET ETH WALLET **************************************************
            logger.log('Getting ETH wallet.');
            const etherProvider = new ethers.JsonRpcProvider(ethRpcUrl);
            const ethWallet = new ethers.Wallet(ethPrivateKey, etherProvider);

            // START MAIN FLOW

            // INIT WORKER **************************************************
            logger.log('Fetching zkApp worker.');
            const TokenBridgeWorker = getTokenBridgeWorker();
            const tokenBridgeWorker = new TokenBridgeWorker();

            // Configure wallet
            // In reality we would not pass this from the main thread. We would rely on the WALLET for signatures.
            await tokenBridgeWorker.WALLET_setMinaPrivateKey(
                minaSenderPrivateKeyBase58
            );
            await tokenBridgeWorker.minaSetup(minaConfig);

            // OBTAIN CREDENTIAL **************************************************

            // CLIENT *******************

            // Note this value is used to restrict the domain of the signature but could
            // also be a user provided secret for extra security.
            const messageSCRAMStr = 'NoriZK25';
            // Sign SCRAM message using Mina private key (via worker).
            // This is used such that we can deterministically derive our codeChallenge
            // used for the SCRAM code exchange without the user having to store
            // any secret, when a fixed message is used.
            // If the user uses a fixed message then they could use their Mina key to re generate
            // their signature (and therefore codeChallenge) on another machine.
            // If they provided a secret message then they would have to keep this themselves and provide it when minting.
            logger.log('Signing SCRAM message');
            const scramSignTimer = createTimer();
            const signatureSCRAMBase58 = await tokenBridgeWorker.MOCK_SCRAM_signMessage(messageSCRAMStr);
            logger.log(`SCRAM signature computed in ${scramSignTimer()}`);

            // CLIENT only logic from now on....

            // Create code challenge from SCRAM signature
            const codeChallengeSCRAMStr = await tokenBridgeWorker.SCRAM_createCodeChallenge(signatureSCRAMBase58);
            const codeChallengeSCRAMBigInt = BigInt(codeChallengeSCRAMStr);

            // These prints are just for testing purposes.
            logger.log(
                'senderPublicKey.toBase58()',
                minaSenderPublicKeyBase58
            );
            logger.log(
                'senderPrivateKey.toBase58()',
                minaSenderPrivateKeyBase58
            );
            logger.log('signatureSCRAMBase58', signatureSCRAMBase58);
            logger.log('codeChallengeSCRAMBigInt', codeChallengeSCRAMBigInt);
            logger.log('codeChallengeSCRAMStr', codeChallengeSCRAMStr);

            // CONNECT TO BRIDGE **************************************************

            // Establish a connection to the bridge.
            logger.log('Establishing bridge connection and topics.');
            const { bridgeSocket$, bridgeSocketConnectionState$ } =
                getReconnectingBridgeSocket$(noriWssUrl);

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
            const abi = noriEthTokenBridgeJson.abi;
            const contract = new ethers.Contract(
                noriETHBridgeAddressHex,
                abi,
                ethWallet
            );
            const credentialAttestationBigNumberIsh: BigNumberish =
                codeChallengeSCRAMBigInt;
            const depositAmountStr = '0.0001'; // 100 BU (minimum lock amount)
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
                bridgeTimingsTopic$,
            );

            // Subscribe to the depositProcessingStatus observable to print our progress.
            depositProcessingStatusSubscription =
                depositProcessingStatus$.subscribe({
                    next: (msg) => logger.info(msg),
                    error: (err) => logger.error(err),
                    complete: () =>
                        logger.warn(
                            'Deposit processing completed. Mint opportunity has been missed :('
                        ),
                });

            // COMPUTE DEPOSIT ATTESTATION **************************************************

            // PREPARE FOR MINTING **************************************************

            // Compile tokenBridgeWorker dependancies
            logger.log('Compiling dependancies of tokenBridgeWorker');
            const tokenBridgeWorkerReady = tokenBridgeWorker.compileAll(); // ?? Can we move this earlier...

            // Get noriStorageInterfaceVerificationKeySafe from tokenBridgeWorkerReady resolution.
            const { noriStorageInterfaceVerificationKeySafe } =
                await tokenBridgeWorkerReady;
            logger.log('Awaited compilation of tokenBridgeWorkerReady');

            // SETUP STORAGE **************************************************
            // TODO IMPROVE THIS
            const setupRequired = await tokenBridgeWorker.needsToSetupStorage(
                noriTokenBridgeAddressBase58,
                minaSenderPublicKeyBase58
            );

            logger.log(`Setup storage required? '${setupRequired}'`);
            if (setupRequired) {
                logger.log('Setting up storage');
                const setupStorageTimer = createTimer();
                const { txHash: setupTxHash } =
                    await tokenBridgeWorker.MOCK_setupStorage(
                        minaSenderPublicKeyBase58,
                        noriTokenBridgeAddressBase58,
                        0.1 * 1e9,
                        noriStorageInterfaceVerificationKeySafe
                    );
                // NOTE! ************
                // Really a client would use await tokenBridgeWorker.setupStorage(...args) and get a provedSetupTxStr which would be submitted to the WALLET for signing
                // Currently we don't have the correct logic for emulating the wallet signAndSend method. However tokenBridgeWorker.setupStorage should be used on the
                // frontend.
                /*const provedSetupTxStr = await tokenBridgeWorker.setupStorage(
                    senderPublicKeyBase58,
                    noriTokenBridgeAddressBase58,
                    0.1 * 1e9,
                    noriStorageInterfaceVerificationKeySafe
                );
                logger.log('provedSetupTxStr', provedSetupTxStr);*/
                // The below should use a real wallets signAndSend method.
                /*const { txHash: setupTxHash } =
                await tokenBridgeWorker.WALLET_signAndSend(provedSetupTxStr);*/

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

            // Compute deposit witness
            logger.log('Computing deposit witness.');
            const depositAttestationInput =
                await tokenBridgeWorker.computeDepositAttestationWitness(
                    codeChallengeSCRAMStr,
                    depositBlockNumber,
                    noriETHBridgeAddressHex,
                    noriPcsUrl
                );
            logger.log('Computed deposit witness.');

            // PRE-COMPUTE MINT PROOF ****************************************************

            logger.log('Determining user funding status.');
            const needsToFundAccount = await tokenBridgeWorker.needsToFundAccount(
                noriTokenBaseAddressBase58,
                minaSenderPublicKeyBase58
            );
            logger.log('needsToFundAccount', needsToFundAccount);

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

            logger.log('Computing mint proof.');

            const mintProofComputationTimer = createTimer();
            await tokenBridgeWorker.MOCK_computeMintProofAndCache(
                minaSenderPublicKeyBase58,
                noriTokenBridgeAddressBase58,
                depositAttestationInput,
                messageSCRAMStr,
                signatureSCRAMBase58,
                1e9 * 0.1,
                needsToFundAccount
            );
            logger.log(`Mint proof computation in ${mintProofComputationTimer()}`);
            // NOTE!
            // Really a client would use await tokenBridgeWorker.mint(...args) and get a provedMintTxStr which would be submitted to the WALLET for signing
            // Currently we don't have the correct logic for emulating the wallet signAndSend method. However tokenBridgeWorker.mint should be used on the
            // frontend, and at this stage, instead of the above:
            /*const provedMintTxStr = await tokenBridgeWorker.mint(
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

            // SIGN AND SEND MINT PROOF **************************************************

            const mintTransactionFinalizedTimer = createTimer();
            const { txHash: mintTxHash } =
                await tokenBridgeWorker.WALLET_MOCK_signAndSendMintProofCache();
            // Note a client would really use a wallet.signAndSend(provedMintTxStr) method at this point instead of the above.
            // And ideally when WALLET_signAndSend works properly we would replace the above(within this test only!) with the below MOCK for wallet behaviour.
            /*const { txHash: mintTxHash } =
            await tokenBridgeWorker.WALLET_signAndSend(provedMintTxStr);*/
            logger.log('mintTxHash', mintTxHash);
            logger.log(`Mint transaction finalized in ${mintTransactionFinalizedTimer()}`);
            logger.log('Minted!');

            // Get the amount minted so far and print it
            const mintedSoFar = await tokenBridgeWorker.mintedSoFar(
                noriTokenBridgeAddressBase58,
                minaSenderPublicKeyBase58
            );
            logger.log('mintedSoFar', mintedSoFar);

            const balanceOfUser = await tokenBridgeWorker.getBalanceOf(
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
