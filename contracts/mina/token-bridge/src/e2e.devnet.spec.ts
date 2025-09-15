import 'dotenv/config';
import { NetworkId, PrivateKey } from 'o1js';
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
import { BigNumberish, ethers, TransactionResponse } from 'ethers';
import { noriTokenBridgeJson } from '@nori-zk/ethereum-token-bridge';
import {
    createCodeChallenge,
    obtainCodeVerifierFromEthSignature,
} from './pkarm.js';

function validateEnv(): {
    ethPrivateKey: string;
    ethRpcUrl: string;
    noriETHBridgeAddressHex: string;
    noriTokenControllerAddressBase58: string;
    minaRpcUrl: string;
    minaSenderPrivateKeyBase58: string;
    noriTokenBaseAddressBase58: string;
} {
    const errors: string[] = [];

    const {
        ETH_PRIVATE_KEY,
        ETH_RPC_URL,
        NORI_TOKEN_BRIDGE_ADDRESS,
        NORI_TOKEN_CONTROLLER_ADDRESS,
        MINA_RPC_NETWORK_URL,
        SENDER_PRIVATE_KEY,
        TOKEN_BASE_ADDRESS,
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
        !NORI_TOKEN_BRIDGE_ADDRESS ||
        !/^0x[a-fA-F0-9]{40}$/.test(NORI_TOKEN_BRIDGE_ADDRESS)
    ) {
        errors.push(
            'NORI_TOKEN_BRIDGE_ADDRESS missing or invalid (expected 0x-prefixed 40 hex chars)'
        );
    }

    if (
        !NORI_TOKEN_CONTROLLER_ADDRESS ||
        !/^[1-9A-HJ-NP-Za-km-z]+$/.test(NORI_TOKEN_CONTROLLER_ADDRESS)
    ) {
        errors.push(
            'NORI_TOKEN_CONTROLLER_ADDRESS missing or invalid (expected Base58 string)'
        );
    }

    if (
        !TOKEN_BASE_ADDRESS ||
        !/^[1-9A-HJ-NP-Za-km-z]+$/.test(TOKEN_BASE_ADDRESS)
    ) {
        errors.push(
            'TOKEN_BASE_ADDRESS missing or invalid (expected Base58 string)'
        );
    }

    if (!MINA_RPC_NETWORK_URL || !/^https?:\/\//.test(MINA_RPC_NETWORK_URL)) {
        errors.push(
            'MINA_RPC_NETWORK_URL missing or invalid (expected http(s) URL)'
        );
    }

    if (
        !SENDER_PRIVATE_KEY ||
        !/^[1-9A-HJ-NP-Za-km-z]+$/.test(SENDER_PRIVATE_KEY)
    ) {
        errors.push(
            'SENDER_PRIVATE_KEY missing or invalid (expected Base58 string)'
        );
    }

    if (errors.length) {
        console.error('Environment validation errors:');
        errors.forEach((e) => console.error(' - ' + e));
        process.exit(1);
    }

    return {
        ethPrivateKey: ETH_PRIVATE_KEY,
        ethRpcUrl: ETH_RPC_URL,
        noriETHBridgeAddressHex: NORI_TOKEN_BRIDGE_ADDRESS,
        noriTokenControllerAddressBase58: NORI_TOKEN_CONTROLLER_ADDRESS,
        noriTokenBaseAddressBase58: TOKEN_BASE_ADDRESS,
        minaRpcUrl: MINA_RPC_NETWORK_URL,
        minaSenderPrivateKeyBase58: SENDER_PRIVATE_KEY,
    };
}

// https://faucet.minaprotocol.com/

describe('e2e_testnet', () => {
    test('e2e_complete_testnet', async () => {
        let depositProcessingStatusSubscription: Subscription;
        try {
            // Get ENV VARS
            const {
                ethPrivateKey,
                ethRpcUrl,
                noriETHBridgeAddressHex,
                noriTokenControllerAddressBase58,
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
            console.log('Getting ETH wallet.');
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
            console.log('Creating eth signature of our secret / fixed field');
            console.time('ethSignatureSecret');
            const ethSignatureSecret = await signSecretWithEthWallet(
                fixedValueOrSecret,
                ethWallet
            );
            console.timeEnd('ethSignatureSecret');

            // These prints are just for testing purposes.
            console.log('ethSignatureSecret', ethSignatureSecret);
            console.log(
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

            console.log('ethSignatureSecret', ethSignatureSecret);
            console.log(
                'senderPublicKey.toBase58()',
                minaSenderPublicKeyBase58
            );
            console.log(
                'senderPrivateKey.toBase58()',
                minaSenderPrivateKeyBase58
            );
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
            const abi = noriTokenBridgeJson.abi;
            const contract = new ethers.Contract(
                noriETHBridgeAddressHex,
                abi,
                ethWallet
            );
            const credentialAttestationBigNumberIsh: BigNumberish =
                codeChallengePKARMBigInt;
            const depositAmountStr = '0.000001';
            console.log('depositAmountStr', depositAmountStr);
            const depositAmount = ethers.parseEther(depositAmountStr);
            const result: TransactionResponse = await contract.lockTokens(
                credentialAttestationBigNumberIsh,
                { value: depositAmount }
            );
            console.log('Eth deposit made', result);
            console.log('Waiting for 1 confirmation');
            const confirmedResult = await result.wait();
            console.log('Confirmed Eth Deposit', confirmedResult);
            const depositBlockNumber = confirmedResult.blockNumber;
            if (!depositBlockNumber) {
                console.error('depositBlockNumber was falsey');
            }
            console.log(
                `Deposit confirmed with blockNumber: ${depositBlockNumber}`
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

            // INIT WORKER **************************************************
            console.log('Fetching zkApp worker.');
            const ZkAppWorker = getZkAppWorker();

            // Compile zkAppWorker dependancies
            console.log('Compiling dependancies of zkAppWorker');
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
            console.log('Awaited compilation of zkAppWorkerReady');

            // SETUP STORAGE **************************************************
            // TODO IMPROVE THIS
            const setupRequired = await zkAppWorker.needsToSetupStorage(
                noriTokenControllerAddressBase58,
                minaSenderPublicKeyBase58
            );

            console.log(`Setup storage required? '${setupRequired}'`);
            if (setupRequired) {
                console.log('Setting up storage');
                console.time('noriMinter.setupStorage');
                const { txHash: setupTxHash } =
                    await zkAppWorker.MOCK_setupStorage(
                        minaSenderPublicKeyBase58,
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
                // The below should use a real wallets signAndSend method.
                /*const { txHash: setupTxHash } =
                await zkAppWorker.WALLET_signAndSend(provedSetupTxStr);*/

                console.log('setupTxHash', setupTxHash);
                console.timeEnd('noriMinter.setupStorage');
            }

            // Block until we can compute our deposit attestation proof.
            console.log(
                'Waiting for ProofConversionJobSucceeded on WaitingForCurrentJobCompletion before we can compute our EthDeposit proof.'
            );

            // Waits for proof conversion to be finished.
            // Throws if we have missed our minting opportunity.
            await readyToComputeMintProof(depositProcessingStatus$);

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

            // PRE-COMPUTE MINT PROOF ****************************************************

            console.log('Determining user funding status.');
            const needsToFundAccount = await zkAppWorker.needsToFundAccount(
                noriTokenBaseAddressBase58,
                minaSenderPublicKeyBase58
            );
            console.log('needsToFundAccount', needsToFundAccount);

            console.log('Computing mint proof.');

            console.time('Mint proof computation');
            await zkAppWorker.MOCK_computeMintProofAndCache(
                minaSenderPublicKeyBase58,
                noriTokenControllerAddressBase58,
                ethVerifierProofJson,
                depositAttestationInput,
                codeVerifierPKARMStr,
                1e9 * 0.1,
                needsToFundAccount
            );
            console.timeEnd('Mint proof computation');
            // NOTE!
            // Really a client would use await zkAppWorker.mint(...args) and get a provedMintTxStr which would be submitted to the WALLET for signing
            // Currently we don't have the correct logic for emulating the wallet signAndSend method. However zkAppWorker.mint should be used on the
            // frontend, and at this stage, instead of the above:
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

            // WAIT FOR DEPOSIT PROCESSING COMPLETED BY BRIDGE BEFORE SENDING OUR MINT PROOF TO MINA **********************

            console.log(
                'Waiting for deposit processing completion before we can sign and send the mint proof.'
            );

            // Block until deposit has been processed (when the depositProcessingStatus$ observable completes)
            // Throws if we have missed our minting opportunity
            await canMint(depositProcessingStatus$);
            console.log(
                'Deposit is processed signing and sending the mint proof.'
            );

            // SIGN AND SEND MINT PROOF **************************************************

            console.time('Mint transaction finalized');
            const { txHash: mintTxHash } =
                await zkAppWorker.WALLET_MOCK_signAndSendMintProofCache();
            // Note a client would really use a wallet.signAndSend(provedMintTxStr) method at this point instead of the above.
            // And ideally when WALLET_signAndSend works properly we would replace the above(within this test only!) with the below MOCK for wallet behaviour.
            /*const { txHash: mintTxHash } =
            await zkAppWorker.WALLET_signAndSend(provedMintTxStr);*/
            console.log('mintTxHash', mintTxHash);
            console.timeEnd('Mint transaction finalized');
            console.log('Minted!');

            // Get the amount minted so far and print it
            const mintedSoFar = await zkAppWorker.mintedSoFar(
                noriTokenControllerAddressBase58,
                minaSenderPublicKeyBase58
            );
            console.log('mintedSoFar', mintedSoFar);

            const balanceOfUser = await zkAppWorker.getBalanceOf(
                noriTokenBaseAddressBase58,
                minaSenderPublicKeyBase58
            );
            console.log('balanceOfUser', balanceOfUser);

            // END MAIN FLOW
        } finally {
            if (depositProcessingStatusSubscription)
                depositProcessingStatusSubscription.unsubscribe();
        }
    }, 1000000000);
});
