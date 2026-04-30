import { Logger, LogPrinter } from 'esm-iso-logger';
import { PrivateKey } from 'o1js';
import { getReconnectingBridgeSocket$ } from '@nori-zk/mina-token-bridge/rx/socket';
import {
    getBridgeStateTopic$,
    getBridgeTimingsTopic$,
    getEthStateTopic$,
} from '@nori-zk/mina-token-bridge/rx/topics';
import type { Subscription } from 'rxjs';
import {
    bridgeStatusesKnownEnoughToLockUnsafe,
    canMint,
    getDepositProcessingStatus$,
    readyToComputeMintProof,
} from '@nori-zk/mina-token-bridge/rx/deposit';
import { getTokenBridgeWorker } from './tokenBridgeWorkerClient.js';
import { getTokenBridgeMintWorker } from './tokenBridgeMintWorkerClient.js';
import { type BigNumberish, ethers, type TransactionResponse } from 'ethers';
import { noriTokenBridgeJson as noriEthTokenBridgeJson, NoriTokenBridge__factory } from '@nori-zk/ethereum-token-bridge';
import { createTimer } from '@nori-zk/o1js-zk-utils';
import { describe, test } from './test-utils/browserTestRunner.js'

function validateEnv(): {
    ethPrivateKey: string;
    ethRpcUrl: string;
    noriETHBridgeAddressHex: string;
    noriMinaTokenBridgeAddressBase58: string;
    noriTokenBaseAddressBase58: string;
    noriWssUrl: string;
    minaSenderPrivateKeyBase58: string;
} {
    const errors: string[] = [];

    const {
        ETH_PRIVATE_KEY,
        ETH_RPC_URL,
        NORI_ETH_TOKEN_BRIDGE_ADDRESS,
        NORI_MINA_TOKEN_BRIDGE_ADDRESS,
        NORI_MINA_TOKEN_BASE_ADDRESS,
        NORI_WSS_URL,
        MINA_SENDER_PRIVATE_KEY,
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
        noriWssUrl: NORI_WSS_URL,
        minaSenderPrivateKeyBase58: MINA_SENDER_PRIVATE_KEY,
    };
}

// https://faucet.minaprotocol.com/

new LogPrinter('MinimalClient');
const logger = new Logger('IndexSpec');

// Resume state. The mint-half (MOCK_computeMintProofAndCache +
// WALLET_MOCK_signAndSendMintProofCache) is the OOM-prone part of the
// flow; everything before it can be cached so a failed retry does not
// have to re-do the eth lock + bridge wait + storage setup. State is
// dumped to `.test-state/mint-resume.json` via the express runner. On
// each test start the file is loaded; if present, the pre-mint flow
// is skipped and we go straight to the mint worker. Cleared after a
// successful mint.
type MintWorkerInstance = InstanceType<ReturnType<typeof getTokenBridgeMintWorker>>;
type DepositAttestationInput = Parameters<
    MintWorkerInstance['MOCK_computeMintProofAndCache']
>[2];
type MintResumeState = {
    depositBlockNumber: number;
    signatureSCRAMBase58: string;
    codeChallengeSCRAMStr: string;
    needsToFundAccount: boolean;
    depositAttestationInput: DepositAttestationInput;
};
const RESUME_URL = '/test-state/mint-resume';
async function loadMintResumeState(): Promise<MintResumeState | null> {
    try {
        const res = await fetch(RESUME_URL);
        if (res.status === 404) return null;
        if (!res.ok) return null;
        return (await res.json()) as MintResumeState;
    } catch (e) {
        logger.warn('Failed to load mint resume state', e);
        return null;
    }
}
async function saveMintResumeState(state: MintResumeState): Promise<void> {
    const res = await fetch(RESUME_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(state),
    });
    if (!res.ok)
        logger.warn(`Failed to save mint resume state: HTTP ${res.status}`);
}
async function clearMintResumeState(): Promise<void> {
    const res = await fetch(RESUME_URL, { method: 'DELETE' });
    if (!res.ok)
        logger.warn(`Failed to clear mint resume state: HTTP ${res.status}`);
}

describe('e2e_testnet', () => {
    test('e2e_complete_testnet', async () => {
        let depositProcessingStatusSubscription: Subscription;
        try {
            const {
                ethPrivateKey,
                ethRpcUrl,
                noriETHBridgeAddressHex,
                noriMinaTokenBridgeAddressBase58,
                noriTokenBaseAddressBase58,
                noriWssUrl,
                minaSenderPrivateKeyBase58,
            } = validateEnv();

            const minaSenderPrivateKey = PrivateKey.fromBase58(
                minaSenderPrivateKeyBase58
            );
            const minaSenderPublicKey = minaSenderPrivateKey.toPublicKey();
            const minaSenderPublicKeyBase58 = minaSenderPublicKey.toBase58();

            // Browser talks to the local proxy which forwards to the real endpoints
            const minaConfig = {
                networkId: 'devnet' as const,
                mina: 'http://localhost:4003/graphql',
                archive: 'http://localhost:4003/archive',
            };

            // Note this value is used to restrict the domain of the signature but could
            // also be a user provided secret for extra security.
            const messageSCRAMStr = 'NoriZK25';

            // Inputs to MOCK_computeMintProofAndCache. Either populated by
            // running the full pre-mint flow, or restored from a cached
            // resume file written by a previous run that got past
            // `canMint` but failed in the mint worker.
            let depositBlockNumber: number;
            let signatureSCRAMBase58: string;
            let codeChallengeSCRAMStr: string;
            let depositAttestationInput: DepositAttestationInput;
            let needsToFundAccount: boolean;

            const resumeState = await loadMintResumeState();
            if (resumeState) {
                logger.log(
                    'Found cached mint resume state — skipping pre-mint flow.'
                );
                ({
                    depositBlockNumber,
                    signatureSCRAMBase58,
                    codeChallengeSCRAMStr,
                    depositAttestationInput,
                    needsToFundAccount,
                } = resumeState);
                logger.log('Resumed depositBlockNumber:', depositBlockNumber);
                logger.log('Resumed needsToFundAccount:', needsToFundAccount);
            } else {
                // GET ETH WALLET **************************************************
                logger.log('Getting ETH wallet.');
                const etherProvider = new ethers.JsonRpcProvider(ethRpcUrl);
                const ethWallet = new ethers.Wallet(ethPrivateKey, etherProvider);

                // START MAIN FLOW

                // INIT WORKER **************************************************
                logger.log('Fetching token bridge worker.');
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

                // Sign SCRAM message using Mina private key (via worker).
                // This is used such that we can deterministically derive our codeChallenge
                // used for the SCRAM code exchange without the user having to store
                // any secret, when a fixed message is used.
                // If the user uses a fixed message then they could use their Mina key to re generate
                // their signature (and therefore codeChallenge) on another machine.
                // If they provided a secret message then they would have to keep this themselves and provide it when minting.
                logger.log('Signing SCRAM message');
                const scramSignTimer = createTimer();
                signatureSCRAMBase58 = await tokenBridgeWorker.MOCK_SCRAM_signMessage(messageSCRAMStr);
                logger.log(`SCRAM signature computed in ${scramSignTimer()}`);

                // CLIENT only logic from now on....

                // Create code challenge from SCRAM signature
                codeChallengeSCRAMStr = await tokenBridgeWorker.SCRAM_createCodeChallenge(signatureSCRAMBase58);
                const codeChallengeSCRAMBigInt = BigInt(codeChallengeSCRAMStr);

                // These prints are just for testing purposes.
                logger.log(
                    'senderPublicKey.toBase58()',
                    minaSenderPublicKeyBase58
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
                const contract = NoriTokenBridge__factory.connect(noriETHBridgeAddressHex, ethWallet);
                /*const abi = noriEthTokenBridgeJson.abi;
                const contract = new ethers.Contract(
                    noriETHBridgeAddressHex,
                    abi,
                    ethWallet
                );*/
                const credentialAttestationBigNumberIsh: BigNumberish =
                    codeChallengeSCRAMBigInt;
                const depositAmountStr = '0.0001'; // 100 BU (minimum lock amount)
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
                depositBlockNumber = confirmedResult.blockNumber;
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

                // Compile tokenBridgeWorker dependancies
                logger.log('Compiling dependancies of tokenBridgeWorker');
                const tokenBridgeWorkerReady = tokenBridgeWorker.compileAll(
                    'http://localhost:4210'
                ); // ?? Can we move this earlier...

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
                depositAttestationInput =
                    await tokenBridgeWorker.computeDepositAttestationWitness(
                        codeChallengeSCRAMStr,
                        depositBlockNumber,
                        'http://localhost:4003'
                    );
                logger.log(`Deposit witness computed in ${depositWitnessTimer()}`);
                logger.log(
                    'Calculated deposit witness.'
                );

                // PRE-COMPUTE MINT PROOF ****************************************************

                logger.log('Determining user funding status.');
                needsToFundAccount = await tokenBridgeWorker.needsToFundAccount(
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

                tokenBridgeWorker.signalTerminate()
                //wait 3 sec
                await new Promise((resolve) => setTimeout(resolve, 3000));

                // Persist mint inputs so the next run can resume here if
                // the mint worker fails. Cleared after a successful mint.
                await saveMintResumeState({
                    depositBlockNumber,
                    signatureSCRAMBase58,
                    codeChallengeSCRAMStr,
                    depositAttestationInput,
                    needsToFundAccount,
                });
                logger.log('Saved mint resume state.');
            }

            logger.log('Fetching token bridge mint worker.');
            const TokenBridgeWorkerMint = getTokenBridgeMintWorker();
            const tokenBridgeWorkerMint = new TokenBridgeWorkerMint();

            // Configure wallet
            // In reality we would not pass this from the main thread. We would rely on the WALLET for signatures.
            await tokenBridgeWorkerMint.WALLET_setMinaPrivateKey(
                minaSenderPrivateKeyBase58
            );
            await tokenBridgeWorkerMint.minaSetup(minaConfig);
            await tokenBridgeWorkerMint.compileAll();

            logger.log('Computing mint proof.');

            const mintProofComputationTimer = createTimer();
            await tokenBridgeWorkerMint.MOCK_computeMintProofAndCache(
                minaSenderPublicKeyBase58,
                noriMinaTokenBridgeAddressBase58,
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
                noriMinaTokenBridgeAddressBase58, // CHECKME @Karol
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
                await tokenBridgeWorkerMint.WALLET_MOCK_signAndSendMintProofCache();
            // Note a client would really use a wallet.signAndSend(provedMintTxStr) method at this point instead of the above.
            // And ideally when WALLET_signAndSend works properly we would replace the above(within this test only!) with the below MOCK for wallet behaviour.
            /*const { txHash: mintTxHash } =
            await tokenBridgeWorker.WALLET_signAndSend(provedMintTxStr);*/
            logger.log('mintTxHash', mintTxHash);
            logger.log(`Mint transaction finalized in ${mintTransactionFinalizedTimer()}`);
            logger.log('Minted!');

            // Mint succeeded — drop the resume cache so the next run starts fresh.
            await clearMintResumeState();
            logger.log('Cleared mint resume state.');

            // Get the amount minted so far and print it
            const mintedSoFar = await tokenBridgeWorkerMint.mintedSoFar(
                noriMinaTokenBridgeAddressBase58,
                minaSenderPublicKeyBase58
            );
            logger.log('mintedSoFar', mintedSoFar);

            const balanceOfUser = await tokenBridgeWorkerMint.getBalanceOf(
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
