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
import { getZkAppWorker } from './workers/zkAppWorker/node/parent.js';
import { getTokenDeployerWorker } from './workers/tokenDeployer/node/parent.js';
import {
    createCodeChallenge,
    obtainCodeVerifierFromEthSignature,
} from './pkarm.js';

describe('e2e', () => {
    // Define litenet mina config
    const minaConfig = {
        networkId: 'devnet' as NetworkId,
        mina: 'http://localhost:8080/graphql',
    };

    let tokenBaseAddressBase58: string;
    let noriTokenControllerAddressBase58: string;

    test('e2e_complete', async () => {
        // DEPLOY TEST CONTRACTS **************************************************
        // Deploy token minter contracts (Note this will normally be done already for the user, this is just for testing)
        // Use the worker to be able to reclaim some ram
        console.log('Deploying contract.');
        const TokenDeployerWorker = getTokenDeployerWorker();
        const tokenDeployer = new TokenDeployerWorker();
        const { noriStorageInterfaceVerificationKeySafe } =
            await tokenDeployer.compile();
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
        await tokenDeployer.minaSetup(minaConfig);
        const { tokenBaseAddress, noriTokenControllerAddress } =
            await tokenDeployer.deployContracts(
                contractSenderPrivateKeyBase58,
                contractSenderPrivateKey.toPublicKey().toBase58(), // Admin
                tokenControllerPrivateKey.toBase58(),
                tokenBasePrivateKey.toBase58(),
                ethProcessorAddress,
                noriStorageInterfaceVerificationKeySafe,
                0.1 * 1e9,
                {
                    symbol: 'nETH',
                    decimals: 18,
                    allowUpdates: true,
                }
            );
        tokenBaseAddressBase58 = tokenBaseAddress;
        noriTokenControllerAddressBase58 = noriTokenControllerAddress;
        tokenDeployer.terminate();

        console.log('tokenBaseAddressBase58', tokenBaseAddressBase58);
        console.log(
            'noriTokenControllerAddressBase58',
            noriTokenControllerAddressBase58
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
            console.log('Getting ETH wallet.');
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
            console.log('Creating eth signature of our secret / fixed field');
            console.time('ethSignatureSecret');
            const ethSignatureSecret = await signSecretWithEthWallet(
                fixedValueOrSecret,
                ethWallet
            );
            console.timeEnd('ethSignatureSecret');

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
            console.log('ethSignatureSecret', ethSignatureSecret);
            console.log('senderPublicKey.toBase58()', senderPublicKeyBase58);
            console.log('senderPrivateKey.toBase58()', senderPrivateKeyBase58);
            console.log('codeVerifierPKARMField', codeVerifierPKARMField);
            console.log('codeVerifierPKARMBigInt', codeVerifierPKARMBigInt);
            console.log('codeVerifierPKARMStr', codeVerifierPKARMStr);
            console.log('codeChallengePKARMBigInt', codeChallengePKARMBigInt);
            console.log('codeChallengePKARMStr', codeChallengePKARMStr);

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
                codeChallengePKARMField,
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

            // INIT zkApp WORKER **************************************************
            console.log('Fetching zkApp worker.');
            const ZkAppWorker = getZkAppWorker();

            // Compile zkAppWorker dependancies
            console.log('Compiling dependancies of zkAppWorker');
            const zkAppWorker = new ZkAppWorker();
            const zkAppWorkerReady = zkAppWorker.compileMinterDeps();

            // Block until we can compute our deposit attestation proof.
            console.log(
                'Waiting for ProofConversionJobSucceeded on WaitingForCurrentJobCompletion before we can compute our EthDeposit proof.'
            );

            // Throws if we have missed our minting opportunity
            await readyToComputeMintProof(depositProcessingStatus$);

            // Get noriStorageInterfaceVerificationKeySafe from zkAppWorkerReady resolution.
            const { noriStorageInterfaceVerificationKeySafe } =
                await zkAppWorkerReady;
            console.log('Awaited compilation of zkAppWorkerReady');

            // Compute eth verifier and deposit witness
            console.log(
                'Computing eth verifier and calculating deposit witness.'
            );
            const { ethVerifierProofJson, depositAttestationInput } =
                await zkAppWorker.computeDepositAttestationWitnessAndEthVerifier(
                    codeChallengePKARMStr,
                    depositBlockNumber,
                    ethAddressLowerHex
                );
            console.log(
                'Computed eth verifier and calculated deposit witness.'
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
            await zkAppWorker.WALLET_setMinaPrivateKey(senderPrivateKeyBase58);
            await zkAppWorker.minaSetup(minaConfig);
            console.log('Mint setup');

            // SETUP STORAGE **************************************************

            console.time('noriMinter.setupStorage');
            const { txHash: setupTxHash } = await zkAppWorker.MOCK_setupStorage(
                senderPublicKeyBase58,
                noriTokenControllerAddressBase58,
                0.1 * 1e9,
                noriStorageInterfaceVerificationKeySafe
            );

            // NOTE! ************
            // Really a client would use await zkAppWorker.setupStorage(...args) and get a provedSetupTxStr which would be submitted to the WALLET for signing
            // Currently we don't have the correct logic for emulating the wallet signAndSend method. However zkAppWorker.setupStorage should be used on the
            // frontend.
            /*const provedSetupTxStr = await zkAppWorker.setupStorage(
                senderPublicKeyBase58,
                noriTokenControllerAddressBase58,
                0.1 * 1e9,
                noriTokenControllerVerificationKeySafe
            );
            console.log('provedSetupTxStr', provedSetupTxStr);*/
            // MOCK for wallet behaviour
            /*const { txHash: setupTxHash } =
            await zkAppWorker.WALLET_signAndSend(provedSetupTxStr);*/

            console.log('setupTxHash', setupTxHash);
            console.timeEnd('noriMinter.setupStorage');

            // MINT **************************************************

            console.log('Determining user funding status.');
            const needsToFundAccount = await zkAppWorker.needsToFundAccount(
                tokenBaseAddressBase58,
                senderPublicKeyBase58
            );
            console.log('needsToFundAccount', needsToFundAccount);

            console.time('Minting');
            const { txHash: mintTxHash } = await zkAppWorker.MOCK_mint(
                senderPublicKeyBase58,
                noriTokenControllerAddressBase58,
                ethVerifierProofJson,
                depositAttestationInput,
                codeVerifierPKARMStr,
                1e9 * 0.1,
                needsToFundAccount // needsToFundAccount should resolve to be true for this test.
            );

            // NOTE! ************
            // Really a client would use await zkAppWorker.mint(...args) and get a provedMintTxStr which would be submitted to the WALLET for signing
            // Currently we don't have the correct logic for emulating the wallet signAndSend method. However zkAppWorker.mint should be used on the
            // frontend.
            /*const provedMintTxStr = await zkAppWorker.mint(
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
            await zkAppWorker.WALLET_signAndSend(provedMintTxStr);*/

            console.log('mintTxHash', mintTxHash);
            console.timeEnd('Minted');
            console.log('Minted!');

            // Get the amount minted so far and print it
            const mintedSoFar = await zkAppWorker.mintedSoFar(
                noriTokenControllerAddressBase58,
                senderPublicKeyBase58
            );
            console.log('mintedSoFar', mintedSoFar);

            const balanceOfUser = await zkAppWorker.getBalanceOf(
                tokenBaseAddressBase58,
                senderPublicKeyBase58
            );
            console.log('balanceOfUser', balanceOfUser);

            // END MAIN FLOW
        } finally {
            if (depositProcessingStatusSubscription)
                depositProcessingStatusSubscription.unsubscribe();
        }
    }, 1000000000);
});
