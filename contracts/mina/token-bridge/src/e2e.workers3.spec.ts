import 'dotenv/config';
import { NetworkId, PrivateKey } from 'o1js';
import { getReconnectingBridgeSocket$ } from './rx/socket.js';
import {
    getBridgeStateTopic$,
    getBridgeTimingsTopic$,
    getEthStateTopic$,
} from './rx/topics.js';
import {
    Subscription
} from 'rxjs';
import {
    bridgeStatusesKnownEnoughToLockUnsafe,
    canMint,
    getDepositProcessingStatus$,
    readyToComputeMintProof,
} from './rx/deposit.js';
import { signSecretWithEthWallet } from './ethSignature.js';
import { TokenMintWorker } from './workers/tokenMint/node/parent.js';
import { CredentialAttestationWorker } from './workers/credentialAttestation/node/parent.js';
import { BigNumberish, ethers, TransactionResponse } from 'ethers';
import { noriTokenBridgeJson } from '@nori-zk/ethereum-token-bridge';

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
        NORI_CONTROLLER_PUBLIC_KEY,
        MINA_RPC_NETWORK_URL,
        SENDER_PRIVATE_KEY,
        NORI_TOKEN_PUBLIC_KEY,
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
        !NORI_CONTROLLER_PUBLIC_KEY ||
        !/^[1-9A-HJ-NP-Za-km-z]+$/.test(NORI_CONTROLLER_PUBLIC_KEY)
    ) {
        errors.push(
            'NORI_CONTROLLER_PUBLIC_KEY missing or invalid (expected Base58 string)'
        );
    }

    if (
        !NORI_TOKEN_PUBLIC_KEY ||
        !/^[1-9A-HJ-NP-Za-km-z]+$/.test(NORI_TOKEN_PUBLIC_KEY)
    ) {
        errors.push(
            'NORI_TOKEN_PUBLIC_KEY missing or invalid (expected Base58 string)'
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
        ethPrivateKey: ETH_PRIVATE_KEY!,
        ethRpcUrl: ETH_RPC_URL!,
        noriETHBridgeAddressHex: NORI_TOKEN_BRIDGE_ADDRESS!,
        noriTokenControllerAddressBase58: NORI_CONTROLLER_PUBLIC_KEY!,
        noriTokenBaseAddressBase58: NORI_TOKEN_PUBLIC_KEY!,
        minaRpcUrl: MINA_RPC_NETWORK_URL!,
        minaSenderPrivateKeyBase58: SENDER_PRIVATE_KEY!,
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

            // INIT WORKERS **************************************************
            console.log('Fetching workers.');
            const tokenMintWorker = new TokenMintWorker();
            const credentialAttestationWorker = new CredentialAttestationWorker();

            // READY CREDENTIAL ATTESTATION WORKER **************************************
            console.log('Compiling credentialAttestationWorker dependancies.');
            const credentialAttestationReady =
                credentialAttestationWorker.compile();

            // START MAIN FLOW

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
            console.log(
                'senderPublicKey.toBase58()',
                minaSenderPublicKeyBase58
            );

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
                    minaSenderPublicKeyBase58
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
            console.log('Creating presentation');
            console.time('getPresentation');
            const presentationJsonStr =
                await credentialAttestationWorker.WALLET_computeEcdsaSigPresentation(
                    presentationRequestJson,
                    credentialJson,
                    minaSenderPrivateKeyBase58
                );
            console.timeEnd('getPresentation'); // 46.801s

            // Kill credentialAttestation worker to reclaim ram.
            credentialAttestationWorker.terminate();
            console.log('credentialAttestationWorker terminated');

            // CLIENT only logic from now on....

            // Extract hashed secret from presentation
            const presentation = JSON.parse(presentationJsonStr);
            const messageHashString =
                presentation.outputClaim.value.messageHash.value;
            const credentialAttestationBigInt = BigInt(messageHashString);

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
                credentialAttestationBigInt;
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

            // Compile tokenMintWorker dependancies
            console.log('Compiling dependancies of tokenMintWorker');
            const tokenMintWorkerReady = tokenMintWorker.compileAll(); // ?? Can we move this earlier...

            // PREPARE FOR MINTING **************************************************

            // Configure wallet
            // In reality we would not pass this from the main thread. We would rely on the WALLET for signatures.
            await tokenMintWorker.WALLET_setMinaPrivateKey(
                minaSenderPrivateKeyBase58
            );
            await tokenMintWorker.minaSetup(minaConfig);

            // Get noriTokenControllerVerificationKeySafe from tokenMintWorkerReady resolution.
            const noriTokenControllerVerificationKeySafe =
                await tokenMintWorkerReady;
            console.log('Awaited compilation of tokenMintWorkerReady');

            // SETUP STORAGE **************************************************
            // TODO IMPROVE THIS
            const setupRequired = await tokenMintWorker.needsToSetupStorage(
                noriTokenControllerAddressBase58,
                minaSenderPublicKeyBase58
            );

            console.log(`Setup storage required? '${setupRequired}'`);
            if (setupRequired) {
                console.log('Setting up storage');
                console.time('noriMinter.setupStorage');
                const { txHash: setupTxHash } =
                    await tokenMintWorker.MOCK_setupStorage(
                        minaSenderPublicKeyBase58,
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
                // The below should use a real wallets signAndSend method.
                /*const { txHash: setupTxHash } =
                await tokenMintWorker.WALLET_signAndSend(provedSetupTxStr);*/

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

            console.log('Computing eth deposit proof.');
            const { ethDepositProofJson } =
                await tokenMintWorker.computeEthDeposit(
                    presentationJsonStr,
                    depositBlockNumber,
                    ethAddressLowerHex
                );

            // PRE-COMPUTE MINT PROOF ****************************************************

            console.log('Computing mint proof.');

            console.time('Mint proof computation');
            await tokenMintWorker.MOCK_computeMintProofAndCache(
                minaSenderPublicKeyBase58,
                noriTokenControllerAddressBase58,
                {
                    ethDepositProofJson: ethDepositProofJson,
                    presentationProofStr: presentationJsonStr,
                },
                1e9 * 0.1,
                noriTokenBaseAddressBase58
            );
            console.timeEnd('Mint proof computation');
            // NOTE!
            // Really a client would use await tokenMintWorker.mint(...args) and get a provedMintTxStr which would be submitted to the WALLET for signing
            // Currently we don't have the correct logic for emulating the wallet signAndSend method. However tokenMintWorker.mint should be used on the
            // frontend, and at this stage, instead of the above:
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
                await tokenMintWorker.WALLET_MOCK_signAndSendMintProofCache();
            // Note a client would really use a wallet.signAndSend(provedMintTxStr) method at this point instead of the above.
            // And ideally when WALLET_signAndSend works properly we would replace the above(within this test only!) with the below MOCK for wallet behaviour.
            /*const { txHash: mintTxHash } =
            await tokenMintWorker.WALLET_signAndSend(provedMintTxStr);*/
            console.log('mintTxHash', mintTxHash);
            console.timeEnd('Mint transaction finalized');
            console.log('Minted!');

            // Get the amount minted so far and print it
            const mintedSoFar = await tokenMintWorker.mintedSoFar(noriTokenControllerAddressBase58, minaSenderPublicKeyBase58);
            console.log('mintedSoFar', mintedSoFar);

            const balanceOfUser = await tokenMintWorker.getBalanceOf(noriTokenBaseAddressBase58, minaSenderPublicKeyBase58);
            console.log('balanceOfUser', balanceOfUser);

            // END MAIN FLOW
        } catch (e) {
            throw e;
        } finally {
            depositProcessingStatusSubscription.unsubscribe();
        }
    }, 1000000000);
});
