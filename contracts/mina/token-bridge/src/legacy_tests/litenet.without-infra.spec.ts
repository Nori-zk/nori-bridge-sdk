// NOTE THIS TEST IS NO LONGER VIABLE DUE TO PKARM VERIFYING THE RECIPENT BUT IS LEFT HERE FOR POSTERITY
import { Logger, LogPrinter } from 'esm-iso-logger';
import { type NetworkId, PrivateKey } from 'o1js';
import { getNewMinaLiteNetAccountSK } from '../testUtils.js';
import { getZkAppWorker } from '../workers/zkAppWorker/node/parent.js';
import { getTokenDeployerWorker } from '../workers/tokenDeployer/node/parent.js';
import { TokenDeployerWorker as TokenDeployerWorkerPure } from '../workers/tokenDeployer/worker.js';
import { ZkAppWorker as ZkAppWorkerPure } from '../workers/zkAppWorker/worker.js';
import { createTimer } from '@nori-zk/o1js-zk-utils';

new LogPrinter('TestTokenBridge');
const logger = new Logger('LitenetWithoutInfraSpec');

describe('e2e-without-infra', () => {
    // Define litenet mina config
    const minaConfig = {
        networkId: 'devnet' as NetworkId,
        mina: 'http://localhost:8080/graphql',
    };

    let tokenBaseAddressBase58: string;
    let noriTokenControllerAddressBase58: string;

    test('e2e_complete', async () => {
        // DEPLOY TEST CONTRACTS **************************************************
        // Use the worker to be able to reclaim some ram
        const useDeployerWorkerSubProcess = false;
        logger.log('Deploying contract.');
        const TokenDeployerWorker = useDeployerWorkerSubProcess
            ? getTokenDeployerWorker()
            : TokenDeployerWorkerPure;
        const tokenDeployer = new TokenDeployerWorker();
        const deployedVks = await tokenDeployer.compile();
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
                deployedVks.noriStorageInterfaceVerificationKeySafe,
                0.1 * 1e9,
                {
                    symbol: 'nETH',
                    decimals: 18,
                    allowUpdates: true,
                }
            );
        tokenBaseAddressBase58 = tokenBaseAddress;
        noriTokenControllerAddressBase58 = noriTokenControllerAddress;
        if (
            'terminate' in tokenDeployer &&
            typeof tokenDeployer.terminate === 'function'
        ) {
            tokenDeployer.terminate();
        }

        logger.log('tokenBaseAddressBase58', tokenBaseAddressBase58);
        logger.log(
            'noriTokenControllerAddressBase58',
            noriTokenControllerAddressBase58
        );

        // Generate a funded test private key for mina litenet
        const litenetSk = await getNewMinaLiteNetAccountSK();
        const senderPrivateKey = PrivateKey.fromBase58(litenetSk);
        const senderPrivateKeyBase58 = senderPrivateKey.toBase58();
        const senderPublicKey = senderPrivateKey.toPublicKey();
        const senderPublicKeyBase58 = senderPublicKey.toBase58();

        // START MAIN FLOW

        // Here we are going to use an existing deposit to avoid having to go through the full deployment flow.

        const codeVerifierPKARMStr =
            '28929899377588420303953682814589874820844405496387980906819951860414692093779';
        const codeChallengePKARMStr =
            '15354345367044214131600935236508205003561151324062168867145984717473184332138';

        const ethAddressLowerHex =
            '0xC7e910807Dd2E3F49B34EfE7133cfb684520Da69'.toLowerCase();
        const depositBlockNumber = 4432612;

        // INIT zkApp WORKER **************************************************
        logger.log('Fetching zkApp worker.');

        const ZkAppWorker = useDeployerWorkerSubProcess ? getZkAppWorker() : ZkAppWorkerPure;

        // Compile zkAppWorker dependancies
        logger.log('Compiling dependancies of zkAppWorker');
        const zkAppWorker = new ZkAppWorker();
        const zkAppWorkerReady = zkAppWorker.compileMinterDeps();

        // Get noriStorageInterfaceVerificationKeySafe from zkAppWorkerReady resolution.
        const zkWorkerVks = await zkAppWorkerReady;
        logger.log('Awaited compilation of zkAppWorkerReady');

        // Compare the keys
        type VkKey =
            | 'ethVerifierVerificationKeySafe'
            | 'noriStorageInterfaceVerificationKeySafe'
            | 'fungibleTokenVerificationKeySafe'
            | 'noriTokenControllerVerificationKeySafe';

        const keys: VkKey[] = [
            'ethVerifierVerificationKeySafe',
            'noriStorageInterfaceVerificationKeySafe',
            'fungibleTokenVerificationKeySafe',
            'noriTokenControllerVerificationKeySafe',
        ];

        const errors: string[] = [];

        for (const key of keys) {
            if (deployedVks[key].hashStr !== zkWorkerVks[key].hashStr) {
                errors.push(
                    `${key} mismatch: deployed=${deployedVks[key].hashStr}, worker=${zkWorkerVks[key].hashStr}`
                );
            }
        }

        if (errors.length > 0) {
            throw new Error(
                `Verification key mismatches:\n${errors.join('\n')}`
            );
        }

        // Compute eth verifier and deposit witness
        logger.log('Computing eth verifier and calculating deposit witness.');
        const { ethVerifierProofJson, depositAttestationInput } =
            await zkAppWorker.computeDepositAttestationWitnessAndEthVerifier(
                codeChallengePKARMStr,
                depositBlockNumber,
                ethAddressLowerHex
            );
        logger.log('Computed eth verifier and calculated deposit witness.');

        // PREPARE FOR MINTING **************************************************

        // Configure wallet
        // In reality we would not pass this from the main thread. We would rely on the WALLET for signatures.
        await zkAppWorker.WALLET_setMinaPrivateKey(senderPrivateKeyBase58);
        await zkAppWorker.minaSetup(minaConfig);
        logger.log('Mint setup');

        // SETUP STORAGE **************************************************

        const setupStorageTimer = createTimer();
        const { txHash: setupTxHash } = await zkAppWorker.MOCK_setupStorage(
            senderPublicKeyBase58,
            noriTokenControllerAddressBase58,
            0.1 * 1e9,
            deployedVks.noriStorageInterfaceVerificationKeySafe
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
            logger.log('provedSetupTxStr', provedSetupTxStr);*/
        // MOCK for wallet behaviour
        /*const { txHash: setupTxHash } =
            await zkAppWorker.WALLET_signAndSend(provedSetupTxStr);*/

        logger.log('setupTxHash', setupTxHash);
        logger.log(`Nori minter storage setup in ${setupStorageTimer()}`);

        // MINT **************************************************

        logger.log('Determining user funding status.');
        const needsToFundAccount = await zkAppWorker.needsToFundAccount(
            tokenBaseAddressBase58,
            senderPublicKeyBase58
        );
        logger.log('needsToFundAccount', needsToFundAccount);

        const mintingTimer = createTimer();
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
            logger.log('provedMintTxStr', provedMintTxStr);*/
        // MOCK for wallet behaviour
        /*const { txHash: mintTxHash } =
            await zkAppWorker.WALLET_signAndSend(provedMintTxStr);*/

        logger.log('mintTxHash', mintTxHash);
        logger.log(`Minting completed in ${mintingTimer()}`);
        logger.log('Minted!');

        // Get the amount minted so far and print it
        const mintedSoFar = await zkAppWorker.mintedSoFar(
            noriTokenControllerAddressBase58,
            senderPublicKeyBase58
        );
        logger.log('mintedSoFar', mintedSoFar);

        const balanceOfUser = await zkAppWorker.getBalanceOf(
            tokenBaseAddressBase58,
            senderPublicKeyBase58
        );
        logger.log('balanceOfUser', balanceOfUser);

        // END MAIN FLOW
    }, 1000000000);
});
