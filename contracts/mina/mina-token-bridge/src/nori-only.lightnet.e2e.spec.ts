import { Logger, LogPrinter } from 'esm-iso-logger';
import { type NetworkId, PrivateKey } from 'o1js';
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
import { type Subscription } from 'rxjs';
import {
    bridgeStatusesKnownEnoughToLockUnsafe,
    canMint,
    getDepositProcessingStatus$,
    readyToComputeMintProof,
} from './rx/deposit.js';
import { signSecretWithEthWallet } from './ethSignature.js';
import { getTokenBridgeWorker } from './workers/tokenBridgeWorker/node/parent.js';
import { getTokenBridgeDeployerWorker } from './workers/tokenBridgeDeployer/node/parent.js';
import {
    createCodeChallenge,
    obtainCodeVerifierFromEthSignature,
} from './pkarm.js';
import { createTimer } from '@nori-zk/o1js-zk-utils-new';

new LogPrinter('TestTokenBridge');
const logger = new Logger('E2ELitenetSpec');

describe('e2e', () => {
    // Define litenet mina config
    const minaConfig = {
        networkId: 'devnet' as NetworkId,
        mina: 'http://localhost:8080/graphql',
    };

    let tokenBaseAddressBase58: string;
    let noriTokenBridgeAddressBase58: string;

    test('e2e_complete', async () => {
        // DEPLOY TEST CONTRACTS **************************************************
        // Deploy token minter contracts (Note this will normally be done already for the user, this is just for testing)
        // Use the worker to be able to reclaim some ram
        logger.log('Deploying contract.');
        const TokenBridgeDeployerWorker = getTokenBridgeDeployerWorker();
        const tokenDeployer = new TokenBridgeDeployerWorker();
        const { noriStorageInterfaceVerificationKeySafe } =
            await tokenDeployer.compile();
        const contractsLitenetSk = await getNewMinaLiteNetAccountSK();
        const contractSenderPrivateKey =
            PrivateKey.fromBase58(contractsLitenetSk);
        const contractSenderPrivateKeyBase58 =
            contractSenderPrivateKey.toBase58();
        const noriTokenBridgePrivateKey = PrivateKey.random();
        const tokenBasePrivateKey = PrivateKey.random();
        await tokenDeployer.minaSetup(minaConfig);
        const { tokenBaseAddress, noriTokenBridgeAddress } =
            await tokenDeployer.deployContracts(
                contractSenderPrivateKeyBase58,
                contractSenderPrivateKey.toPublicKey().toBase58(), // Admin
                noriTokenBridgePrivateKey.toBase58(),
                tokenBasePrivateKey.toBase58(),
                "FIXMETHISISTHEWRONGSTOREHASH",
                noriStorageInterfaceVerificationKeySafe,
                0.1 * 1e9,
                {
                    symbol: 'nETH',
                    decimals: 18,
                    allowUpdates: true,
                }
            );
        tokenBaseAddressBase58 = tokenBaseAddress;
        noriTokenBridgeAddressBase58 = noriTokenBridgeAddress;
        tokenDeployer.terminate();

        logger.log('tokenBaseAddressBase58', tokenBaseAddressBase58);
        logger.log(
            'noriTokenBridgeAddressBase58',
            noriTokenBridgeAddressBase58
        );

        let depositProcessingStatusSubscription: Subscription;
        try {
            // Generate a funded test private key for mina litenet
            const litenetSk = await getNewMinaLiteNetAccountSK();
            const senderPrivateKey = PrivateKey.fromBase58(litenetSk);
            const senderPrivateKeyBase58 = senderPrivateKey.toBase58();
            const senderPublicKey = senderPrivateKey.toPublicKey();
            const senderPublicKeyBase58 = senderPublicKey.toBase58();

            // START MAIN FLOW

            // GET WALLET **************************************************
            logger.log('Getting ETH wallet.');
            const ethWallet = await getEthWallet();
            const ethAddressLowerHex = ethWallet.address.toLowerCase();

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
            const ethSignatureTimer = createTimer();
            const ethSignatureSecret = await signSecretWithEthWallet(
                fixedValueOrSecret,
                ethWallet
            );
            logger.log(`Eth signature secret computed in ${ethSignatureTimer()}`);

            // CLIENT only logic from now on....

            // Generate PKARM code challenge from signature and mina public key
            const codeVerifierPKARMField =
                obtainCodeVerifierFromEthSignature(ethSignatureSecret); // This is a secret field
            const codeVerifierPKARMBigInt = codeVerifierPKARMField.toBigInt();
            const codeVerifierPKARMStr = codeVerifierPKARMBigInt.toString();

            const codeChallengePKARMField = createCodeChallenge(
                codeVerifierPKARMField,
                senderPublicKey
            ); // This is the code challenge witness which can be stored publically (on chain)
            const codeChallengePKARMBigInt = codeChallengePKARMField.toBigInt();
            const codeChallengePKARMStr = codeChallengePKARMBigInt.toString();

            // These prints are just for testing purposes.
            logger.log('ethSignatureSecret', ethSignatureSecret);
            logger.log('senderPublicKey.toBase58()', senderPublicKeyBase58);
            logger.log('senderPrivateKey.toBase58()', senderPrivateKeyBase58);
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
            const bridgeStateTimer = createTimer();
            await bridgeStatusesKnownEnoughToLockUnsafe(
                ethStateTopic$,
                bridgeStateTopic$,
                bridgeTimingsTopic$
            );
            logger.log(`Bridge state ready in ${bridgeStateTimer()}`);

            // LOCK TOKENS **************************************************

            logger.log('Locking eth tokens');
            const lockTokensTimer = createTimer();
            const depositAmount = 0.000001;
            logger.log('Deposit amount', depositAmount);
            const depositBlockNumber = await lockTokens(
                codeChallengePKARMField,
                depositAmount
            );
            logger.log(`Tokens locked in ${lockTokensTimer()}`);

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

            // INIT zkApp WORKER **************************************************
            logger.log('Fetching zkApp worker.');
            const TokenBridgeWorker = getTokenBridgeWorker();

            // Compile tokenBridgeWorker dependancies
            logger.log('Compiling dependancies of tokenBridgeWorker');
            const tokenBridgeWorker = new TokenBridgeWorker();
            const tokenBridgeWorkerReady = tokenBridgeWorker.compileMinterDeps();

            // Block until we can compute our deposit attestation proof.
            logger.log(
                'Waiting for ProofConversionJobSucceeded on WaitingForCurrentJobCompletion before we can compute our EthDeposit proof.'
            );

            // Throws if we have missed our minting opportunity
            await readyToComputeMintProof(depositProcessingStatus$);

            // Get noriStorageInterfaceVerificationKeySafe from tokenBridgeWorkerReady resolution.
            const { noriStorageInterfaceVerificationKeySafe } =
                await tokenBridgeWorkerReady;
            logger.log('Awaited compilation of tokenBridgeWorkerReady');

            // Compute eth verifier and deposit witness
            logger.log(
                'Computing eth verifier and calculating deposit witness.'
            );
            const { depositAttestationInput } =
                await tokenBridgeWorker.computeDepositAttestationWitnessAndEthVerifier(
                    codeChallengePKARMStr,
                    depositBlockNumber,
                    ethAddressLowerHex
                );
            logger.log(
                'Computed eth verifier and calculated deposit witness.'
            );

            // WAIT FOR DEPOSIT PROCESSING COMPLETED BY BRIDGE ***************************

            logger.log(
                'Waiting for deposit processing completion before we can complete the minting process.'
            );
            // Block until deposit has been processed (when the depositProcessingStatus$ observable completes)
            // Throws if we have missed our minting opportunity
            await canMint(depositProcessingStatus$);
            logger.log('Deposit is processed unblocking mint process.');

            // PREPARE FOR MINTING **************************************************

            // Configure wallet
            // In reality we would not pass this from the main thread. We would rely on the WALLET for signatures.
            await tokenBridgeWorker.WALLET_setMinaPrivateKey(senderPrivateKeyBase58);
            await tokenBridgeWorker.minaSetup(minaConfig);
            logger.log('Mint setup');

            // SETUP STORAGE **************************************************

            const setupStorageTimer = createTimer();
            const { txHash: setupTxHash } = await tokenBridgeWorker.MOCK_setupStorage(
                senderPublicKeyBase58,
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
            // MOCK for wallet behaviour
            /*const { txHash: setupTxHash } =
            await tokenBridgeWorker.WALLET_signAndSend(provedSetupTxStr);*/

            logger.log('setupTxHash', setupTxHash);
            logger.log(`Nori minter storage setup in ${setupStorageTimer()}`);

            // MINT **************************************************

            logger.log('Determining user funding status.');
            const needsToFundAccount = await tokenBridgeWorker.needsToFundAccount(
                tokenBaseAddressBase58,
                senderPublicKeyBase58
            );
            logger.log('needsToFundAccount', needsToFundAccount);

            const mintingTimer = createTimer();
            const { txHash: mintTxHash } = await tokenBridgeWorker.MOCK_mint(
                senderPublicKeyBase58,
                noriTokenBridgeAddressBase58,
                depositAttestationInput,
                codeVerifierPKARMStr,
                1e9 * 0.1,
                needsToFundAccount // needsToFundAccount should resolve to be true for this test.
            );

            // NOTE! ************
            // Really a client would use await tokenBridgeWorker.mint(...args) and get a provedMintTxStr which would be submitted to the WALLET for signing
            // Currently we don't have the correct logic for emulating the wallet signAndSend method. However tokenBridgeWorker.mint should be used on the
            // frontend.
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
            // MOCK for wallet behaviour
            /*const { txHash: mintTxHash } =
            await tokenBridgeWorker.WALLET_signAndSend(provedMintTxStr);*/

            logger.log('mintTxHash', mintTxHash);
            logger.log(`Minting completed in ${mintingTimer()}`);
            logger.log('Minted!');

            // Get the amount minted so far and print it
            const mintedSoFar = await tokenBridgeWorker.mintedSoFar(
                noriTokenBridgeAddressBase58,
                senderPublicKeyBase58
            );
            logger.log('mintedSoFar', mintedSoFar);

            const balanceOfUser = await tokenBridgeWorker.getBalanceOf(
                tokenBaseAddressBase58,
                senderPublicKeyBase58
            );
            logger.log('balanceOfUser', balanceOfUser);

            // END MAIN FLOW
        } finally {
            if (depositProcessingStatusSubscription)
                depositProcessingStatusSubscription.unsubscribe();
        }
    }, 1000000000);
});
