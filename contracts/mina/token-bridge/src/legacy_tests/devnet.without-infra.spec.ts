// NOTE THIS TEST IS NO LONGER VIABLE DUE TO PKARM VERIFYING THE RECIPENT BUT IS LEFT HERE FOR POSTERITY
import 'dotenv/config';
import { NetworkId, PrivateKey } from 'o1js';
import { getZkAppWorker } from '../workers/zkAppWorker/node/parent.js';
import { getTokenDeployerWorker } from '../workers/tokenDeployer/node/parent.js';
import { TokenDeployerWorker as TokenDeployerWorkerPure } from '../workers/tokenDeployer/worker.js';

// https://faucet.minaprotocol.com/

describe('e2e_testnet_without_infra', () => {
    test('e2e_complete_testnet', async () => {
        // These are throw away devnet creds
        const minaSenderPrivateKeyBase58 =
            'EKDxnahxEV3y2FG66ZzF97qBQANAoVBbQqqXWCSSDsVJwdeWEV9G';

        // Eth details
        const ethAddressLowerHex =
            '0xC7e910807Dd2E3F49B34EfE7133cfb684520Da69'.toLowerCase();
        const depositBlockNumber = 4515528;

        // Other configs
        const minaRpcUrl = 'https://devnet.minaprotocol.network/graphql';
        const minaConfig = {
            networkId: 'testnet' as NetworkId,
            mina: minaRpcUrl,
        };

        // Init mina creds

        const minaSenderPrivateKey = PrivateKey.fromBase58(
            minaSenderPrivateKeyBase58
        );
        const minaSenderPublicKey = minaSenderPrivateKey.toPublicKey();
        const minaSenderPublicKeyBase58 = minaSenderPublicKey.toBase58();

        // Do a deployment ***************************************************************
        let tokenBaseAddressBase58: string;
        let noriTokenControllerAddressBase58: string;

        // DEPLOY TEST CONTRACTS **************************************************
        // Deploy token minter contracts (Note this will normally be done already for the user, this is just for testing)
        // Use the worker to be able to reclaim some ram
        const useDeployerWorkerSubProcess = true;
        console.log('Deploying contract.');
        const TokenDeployerWorker = useDeployerWorkerSubProcess
            ? getTokenDeployerWorker()
            : TokenDeployerWorkerPure;
        const tokenDeployer = new TokenDeployerWorker();
        const deployedVks = await tokenDeployer.compile();
        const tokenControllerPrivateKey = PrivateKey.random();
        const tokenBasePrivateKey = PrivateKey.random();
        const ethProcessorAddress = PrivateKey.random()
            .toPublicKey()
            .toBase58();
        await tokenDeployer.minaSetup(minaConfig);
        const { tokenBaseAddress, noriTokenControllerAddress } =
            await tokenDeployer.deployContracts(
                minaSenderPrivateKeyBase58,
                minaSenderPublicKeyBase58, // Admin
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

        console.log('tokenBaseAddressBase58', tokenBaseAddressBase58);
        console.log(
            'noriTokenControllerAddressBase58',
            noriTokenControllerAddressBase58
        );

        // START MAIN FLOW

        // Use an existing deposit to avoid having to use the infrastructure
        const codeVerifierPKARMStr =
            '28929899377588420303953682814589874820844405496387980906819951860414692093779';
        const codeChallengePKARMStr =
            '12986808969824587176339986437728649315208654166925450390141437174280872846073';

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
        await zkAppWorker.WALLET_setMinaPrivateKey(minaSenderPrivateKeyBase58);
        await zkAppWorker.minaSetup(minaConfig);

        // Get noriStorageInterfaceVerificationKeySafe from zkAppWorkerReady resolution.
        const zkWorkerVks = await zkAppWorkerReady;
        console.log('Awaited compilation of zkAppWorkerReady');

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
            const { txHash: setupTxHash } = await zkAppWorker.MOCK_setupStorage(
                minaSenderPublicKeyBase58,
                noriTokenControllerAddressBase58,
                0.1 * 1e9,
                zkWorkerVks.noriStorageInterfaceVerificationKeySafe
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

        // Compute eth verifier and deposit witness
        console.log('Computing eth verifier and calculating deposit witness.');
        const { ethVerifierProofJson, depositAttestationInput } =
            await zkAppWorker.computeDepositAttestationWitnessAndEthVerifier(
                codeChallengePKARMStr,
                depositBlockNumber,
                ethAddressLowerHex
            );
        console.log('Computed eth verifier and calculated deposit witness.');

        // PRE-COMPUTE MINT PROOF ****************************************************

        console.log('Determining user funding status.');
        const needsToFundAccount = await zkAppWorker.needsToFundAccount(
            tokenBaseAddressBase58,
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
            tokenBaseAddressBase58,
            minaSenderPublicKeyBase58
        );
        console.log('balanceOfUser', balanceOfUser);

        // END MAIN FLOW
    }, 1000000000);
});
