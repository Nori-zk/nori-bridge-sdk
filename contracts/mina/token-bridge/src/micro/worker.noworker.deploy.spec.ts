import { NetworkId, PrivateKey } from 'o1js';
import { getNewMinaLiteNetAccountSK } from '../testUtils.js';

import { TokenDeployerWorker } from './workers/tokenDeployer/worker.js';
import { getTokenDeployerWorker } from './workers/tokenDeployer/node/parent.js';

describe('e2e', () => {
    test('deploy_vs_non_worker_deploy', async () => {
        // Define litenet mina config
        const minaConfig = {
            networkId: 'devnet' as NetworkId,
            mina: 'http://localhost:8080/graphql',
        };

        // DEPLOY TEST CONTRACTS WITH WORKER **************************************************
        const TokenDeployerWorkerChildProcess = getTokenDeployerWorker();
        console.log('Deploying contract child process.');
        //const TokenDeployerWorker = getTokenDeployerWorker();
        const tokenDeployerChildProcess = new TokenDeployerWorkerChildProcess();
        const {
            noriStorageInterfaceVerificationKeySafe:
                noriStorageInterfaceVerificationKeySafeChildProcess,
        } = await tokenDeployerChildProcess.compile();
        const contractsLitenetSkChildProcess =
            await getNewMinaLiteNetAccountSK();
        const contractSenderPrivateKeyChildProcess = PrivateKey.fromBase58(
            contractsLitenetSkChildProcess
        );
        const contractSenderPrivateKeyBase58ChildProcess =
            contractSenderPrivateKeyChildProcess.toBase58();
        const tokenControllerPrivateKeyChildProcess = PrivateKey.random();
        const tokenBasePrivateKeyChildProcess = PrivateKey.random();
        const ethProcessorAddressChildProcess = PrivateKey.random()
            .toPublicKey()
            .toBase58();
        await tokenDeployerChildProcess.minaSetup(minaConfig);
        await tokenDeployerChildProcess.deployContracts(
            contractSenderPrivateKeyBase58ChildProcess,
            contractSenderPrivateKeyChildProcess.toPublicKey().toBase58(), // Admin
            tokenControllerPrivateKeyChildProcess.toBase58(),
            tokenBasePrivateKeyChildProcess.toBase58(),
            ethProcessorAddressChildProcess,
            noriStorageInterfaceVerificationKeySafeChildProcess,
            0.1 * 1e9,
            {
                symbol: 'nETH',
                decimals: 18,
                allowUpdates: true,
            }
        );

        // DEPLOY TEST CONTRACTS WITHOUT WORKER **************************************************
        console.log('Deploying contract without worker.');
        //const TokenDeployerWorker = getTokenDeployerWorker();
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
    }, 1000000000);
});
