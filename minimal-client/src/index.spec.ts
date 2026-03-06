import { Logger, LogPrinter } from 'esm-iso-logger';
import { type NetworkId, PrivateKey } from 'o1js';
import { getReconnectingBridgeSocket$ } from '@nori-zk/mina-token-bridge-new/rx/socket';
import {
    getBridgeStateTopic$,
    getBridgeTimingsTopic$,
    getEthStateTopic$,
} from '@nori-zk/mina-token-bridge-new/rx/topics';
import type { Subscription } from 'rxjs';
import {
    bridgeStatusesKnownEnoughToLockUnsafe,
    canMint,
    getDepositProcessingStatus$,
    readyToComputeMintProof,
} from '@nori-zk/mina-token-bridge-new/rx/deposit';
import { getTokenBridgeWorker } from './tokenBridgeWorkerClient.js';
import { type BigNumberish, ethers, type TransactionResponse } from 'ethers';
import { noriTokenBridgeJson as noriEthTokenBridgeJson } from '@nori-zk/ethereum-token-bridge';
import { signSecretWithEthWallet } from '@nori-zk/mina-token-bridge-new/browser';
import { createTimer } from '@nori-zk/o1js-zk-utils-new';
import { describe, test } from './test-utils/browserTestRunner.js'

function validateEnv(): {
    ethPrivateKey: string;
    ethRpcUrl: string;
    noriETHBridgeAddressHex: string;
    noriMinaTokenBridgeAddressBase58: string;
    minaRpcUrl: string;
    proofConversionServiceUrl: string;
    minaSenderPrivateKeyBase58: string;
    noriTokenBaseAddressBase58: string;
    noriWssUrl: string;
} {
    const errors: string[] = [];

    const {
        ETH_PRIVATE_KEY,
        ETH_RPC_URL,
        NORI_ETH_TOKEN_BRIDGE_ADDRESS,
        NORI_MINA_TOKEN_BRIDGE_ADDRESS,
        MINA_RPC_NETWORK_URL,
        MINA_SENDER_PRIVATE_KEY,
        NORI_MINA_TOKEN_BASE_ADDRESS,
        NORI_PCS_URL,
        NORI_WSS_URL,
    } = process.env;

    if (!ETH_PRIVATE_KEY || !/^[a-fA-F0-9]{64}$/.test(ETH_PRIVATE_KEY)) {
        errors.push(
            'ETH_PRIVATE_KEY missing or invalid (expected 64 hex chars, no 0x prefix)'
        );
    }

    if (!ETH_RPC_URL || !/^https?:\/\//.test(ETH_RPC_URL)) {
        errors.push('ETH_RPC_URL missing or invalid (expected http(s) URL)');
    }

    if (
        !NORI_ETH_TOKEN_BRIDGE_ADDRESS ||
        !/^0x[a-fA-F0-9]{40}$/.test(NORI_ETH_TOKEN_BRIDGE_ADDRESS)
    ) {
        errors.push(
            'NORI_ETH_TOKEN_BRIDGE_ADDRESS missing or invalid (expected 0x-prefixed 40 hex chars)'
        );
    }

    if (
        !NORI_MINA_TOKEN_BRIDGE_ADDRESS ||
        !/^[1-9A-HJ-NP-Za-km-z]+$/.test(NORI_MINA_TOKEN_BRIDGE_ADDRESS)
    ) {
        errors.push(
            'NORI_MINA_TOKEN_BRIDGE_ADDRESS missing or invalid (expected Base58 string)'
        );
    }

    if (
        !NORI_MINA_TOKEN_BASE_ADDRESS ||
        !/^[1-9A-HJ-NP-Za-km-z]+$/.test(NORI_MINA_TOKEN_BASE_ADDRESS)
    ) {
        errors.push(
            'NORI_MINA_TOKEN_BASE_ADDRESS missing or invalid (expected Base58 string)'
        );
    }

    if (!MINA_RPC_NETWORK_URL || !/^https?:\/\//.test(MINA_RPC_NETWORK_URL)) {
        errors.push(
            'MINA_RPC_NETWORK_URL missing or invalid (expected http(s) URL)'
        );
    }

    if (!NORI_PCS_URL || !/^https?:\/\//.test(NORI_PCS_URL)) {
        errors.push(
            'NORI_PCS_URL missing or invalid (expected http(s) URL)'
        );
    }

    if (!NORI_WSS_URL || !/^wss?:\/\//.test(NORI_WSS_URL)) {
        errors.push(
            'NORI_WSS_URL missing or invalid (expected ws(s) URL)'
        );
    }

    if (
        !MINA_SENDER_PRIVATE_KEY ||
        !/^[1-9A-HJ-NP-Za-km-z]+$/.test(MINA_SENDER_PRIVATE_KEY)
    ) {
        errors.push(
            'MINA_SENDER_PRIVATE_KEY missing or invalid (expected Base58 string)'
        );
    }

    if (errors.length) {
        const errorMessage = 'Environment validation errors:\n' + errors.map((e) => ' - ' + e).join('\n');
        logger.fatal(errorMessage);
    }

    return {
        ethPrivateKey: ETH_PRIVATE_KEY,
        ethRpcUrl: ETH_RPC_URL,
        noriETHBridgeAddressHex: NORI_ETH_TOKEN_BRIDGE_ADDRESS,
        noriMinaTokenBridgeAddressBase58: NORI_MINA_TOKEN_BRIDGE_ADDRESS,
        noriTokenBaseAddressBase58: NORI_MINA_TOKEN_BASE_ADDRESS,
        minaRpcUrl: 'http://localhost:4003/graphql', // Note this must be the proxy! MINA_RPC_NETWORK_URL= hardcoding this to be the proxy
        proofConversionServiceUrl: 'http://localhost:4003', // Note this must also be the proxy!
        minaSenderPrivateKeyBase58: MINA_SENDER_PRIVATE_KEY,
        noriWssUrl: NORI_WSS_URL,
    };
}

// https://faucet.minaprotocol.com/

new LogPrinter('MinimalClient');
const logger = new Logger('IndexSpec');

describe('e2e_testnet', () => {
    test('e2e_complete_testnet', async () => {
        let depositProcessingStatusSubscription: Subscription;
        try {
            // Get ENV VARS
            const {
                ethPrivateKey,
                ethRpcUrl,
                noriETHBridgeAddressHex,
                noriMinaTokenBridgeAddressBase58,
                minaRpcUrl,
                minaSenderPrivateKeyBase58,
                noriTokenBaseAddressBase58,
                proofConversionServiceUrl,
                noriWssUrl,
            } = validateEnv();

            const minaSenderPrivateKey = PrivateKey.fromBase58(
                minaSenderPrivateKeyBase58
            );
            const minaSenderPublicKey = minaSenderPrivateKey.toPublicKey();
            const minaSenderPublicKeyBase58 = minaSenderPublicKey.toBase58();

            // Define litenet mina config
            const minaConfig = {
                networkId: 'devnet' as NetworkId,
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

            // INIT WORKER **************************************************
            logger.log('Fetching token bridge worker.');
            const TokenBridgeWorker = getTokenBridgeWorker();

            // Compile tokenBridgeWorker dependancies
            logger.log('Compiling dependancies of tokenBridgeWorker');
            const tokenBridgeWorker = new TokenBridgeWorker();
            const tokenBridgeWorkerReady = tokenBridgeWorker.compileAll(
                'http://localhost:4210'
            ); // ?? Can we move this earlier...

            // Generate PKARM code challenge from signature and mina public key
            const codeVerifierPKARMStr =
                await tokenBridgeWorker.PKARM_obtainCodeVerifierFromEthSignature(
                    ethSignatureSecret
                ); // This is a secret field
            // This is the code challenge witness which can be stored publically (on chain)
            const codeChallengePKARMStr =
                await tokenBridgeWorker.PKARM_createCodeChallenge(
                    codeVerifierPKARMStr,
                    minaSenderPublicKeyBase58
                );
            const codeChallengePKARMBigInt = BigInt(codeChallengePKARMStr);

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
                codeChallengePKARMBigInt;
            const depositAmountStr = '0.000001';
            logger.log('depositAmountStr', depositAmountStr);
            const depositAmount = ethers.parseEther(depositAmountStr);
            const result: TransactionResponse = await contract.lockTokens(
                credentialAttestationBigNumberIsh,
                { value: depositAmount }
            );
            logger.log('Eth deposit made', result.toJSON());
            logger.log('Waiting for 1 confirmation');
            const confirmedResult = await result.wait();
            logger.log('Confirmed Eth Deposit', confirmedResult.toJSON());
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
                    next: (msg) => logger.info(msg),
                    error: (err) => logger.error(err),
                    complete: () =>
                        logger.warn(
                            'Deposit processing completed. Mint opportunity has been missed :('
                        ),
                });

            // COMPUTE DEPOSIT ATTESTATION **************************************************

            // PREPARE FOR MINTING **************************************************

            // Configure wallet
            // In reality we would not pass this from the main thread. We would rely on the WALLET for signatures.
            await tokenBridgeWorker.WALLET_setMinaPrivateKey(
                minaSenderPrivateKeyBase58
            );
            await tokenBridgeWorker.minaSetup(minaConfig);

            // Get noriStorageInterfaceVerificationKeySafe from tokenBridgeWorkerReady resolution.
            const zkVerificationKeys = await tokenBridgeWorkerReady;
            logger.log('Awaited compilation of tokenBridgeWorkerReady');

            // SETUP STORAGE **************************************************
            // TODO IMPROVE THIS
            const setupRequired = await tokenBridgeWorker.needsToSetupStorage(
                noriMinaTokenBridgeAddressBase58,
                minaSenderPublicKeyBase58
            );

            logger.log(`Setup storage required? '${setupRequired}'`);
            if (setupRequired) {
                logger.log('Setting up storage');
                const setupStorageTimer = createTimer();
                const { txHash: setupTxHash } =
                    await tokenBridgeWorker.MOCK_setupStorage(
                        minaSenderPublicKeyBase58,
                        noriMinaTokenBridgeAddressBase58,
                        0.1 * 1e9,
                        zkVerificationKeys.noriStorageInterfaceVerificationKeySafe
                    );
                // NOTE! ************
                // Really a client would use await tokenBridgeWorker.setupStorage(...args) and get a provedSetupTxStr which would be submitted to the WALLET for signing
                // Currently we don't have the correct logic for emulating the wallet signAndSend method. However tokenBridgeWorker.setupStorage should be used on the
                // frontend.
                /*const provedSetupTxStr = await tokenBridgeWorker.setupStorage(
                    minaSenderPublicKeyBase58,
                    noriMinaTokenBridgeAddressBase58,
                    0.1 * 1e9,
                    zkVerificationKeys.noriStorageInterfaceVerificationKeySafe
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
            logger.log(
                'Computing deposit witness.'
            );
            const depositWitnessTimer = createTimer();
            const depositAttestationInput =
                await tokenBridgeWorker.computeDepositAttestationWitness(
                    codeChallengePKARMStr,
                    depositBlockNumber,
                    ethAddressLowerHex,
                    proofConversionServiceUrl
                );
            logger.log(`Deposit witness computed in ${depositWitnessTimer()}`);
            logger.log(
                'Calculated deposit witness.'
            );

            // PRE-COMPUTE MINT PROOF ****************************************************

            logger.log('Determining user funding status.');
            const needsToFundAccount = await tokenBridgeWorker.needsToFundAccount(
                noriTokenBaseAddressBase58,
                minaSenderPublicKeyBase58
            );
            logger.log('needsToFundAccount', needsToFundAccount);

            logger.log('Computing mint proof.');

            const mintProofComputationTimer = createTimer();
            await tokenBridgeWorker.MOCK_computeMintProofAndCache(
                minaSenderPublicKeyBase58,
                noriMinaTokenBridgeAddressBase58,
                depositAttestationInput,
                codeVerifierPKARMStr,
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
                noriMinaTokenBridgeAddressBase58, // CHECKME @Karol
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
                noriMinaTokenBridgeAddressBase58,
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
    }, 3_600_000); // 1 hour timeout
});
