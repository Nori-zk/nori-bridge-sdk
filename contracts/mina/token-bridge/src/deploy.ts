import 'dotenv/config';
import { PrivateKey } from 'o1js';
import { getTokenDeployerWorker } from './workers/tokenDeployer/node/parent.js';
import { Logger } from 'esm-iso-logger';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { rootDir } from './rootDir.js';

const logger = new Logger('DeployTokenController');

// Util to save deployment details to a file
function writeSuccessDetailsToEnvFile(
    noriTokenControllerPrivateKey: string,
    noriTokenControllerAddress: string,
    tokenBasePrivateKey: string,
    tokenBaseAddress: string,
    adminPublicKey: string,
    tokenBaseTokenId: string,
    noriTokenControllerTokenId: string
) {
    const env = {
        NORI_CONTROLLER_PRIVATE_KEY: noriTokenControllerPrivateKey,
        NORI_TOKEN_CONTROLLER_ADDRESS: noriTokenControllerAddress,
        TOKEN_BASE_PRIVATE_KEY: tokenBasePrivateKey,
        TOKEN_BASE_ADDRESS: tokenBaseAddress,
        ADMIN_PUBLIC_KEY: adminPublicKey,
        TOKEN_BASE_TOKEN_ID: tokenBaseTokenId,
        NORI_TOKEN_CONTROLLER_TOKEN_ID: noriTokenControllerTokenId,
    };
    const envFileStr =
        Object.entries(env)
            .map(([key, value]) => `${key}=${value}`)
            .join('\n') + `\n`;
    const envFileOutputPath = resolve(rootDir, '..', '..', '.env.nori-token-bridge');
    logger.info(`Writing env file with the details: '${envFileOutputPath}'`);
    writeFileSync(envFileOutputPath, envFileStr, 'utf8');
    logger.log(`Wrote '${envFileOutputPath}' successfully.`);
}

export async function deployTokenController() {
    logger.log('Deploying Nori Token Controller...');
    const defaultLightnetUrl = 'http://localhost:8080/graphql';
    const networkUrl = process.env.MINA_RPC_NETWORK_URL || defaultLightnetUrl;
    const network =
        networkUrl.includes('localhost') || networkUrl.includes('devnet')
            ? 'testnet'
            : 'mainnet';

    logger.log(`🚀 Starting deployment to ${network}`);
    // Configuration
    // Get or generate sender private key
    let senderPrivateKey = process.env.SENDER_PRIVATE_KEY;

    if (!senderPrivateKey) {
        throw new Error(
            'SENDER_PRIVATE_KEY environment variable is required for non-local deployments'
        );
    }

    // Track if we're creating new keys (new deployment) or using existing ones (VK update)
    const keysWereCreated = !process.env.NORI_CONTROLLER_PRIVATE_KEY || !process.env.TOKEN_BASE_PRIVATE_KEY;

    const noriTokenControllerPrivateKey =
        process.env.NORI_CONTROLLER_PRIVATE_KEY ||
        PrivateKey.random().toBase58();
    const tokenBasePrivateKey =
        process.env.TOKEN_BASE_PRIVATE_KEY || PrivateKey.random().toBase58();

    // Determine if we are a mock
    const mock = !!process.env.MOCK;
    logger.log('mock', mock);

    // Create the config with the saved variables
    const config = {
        senderPrivateKey,
        networkUrl: process.env.MINA_RPC_NETWORK_URL || defaultLightnetUrl,
        network,
        noriTokenControllerPrivateKey,
        tokenBasePrivateKey,
        adminPublicKey:
            process.env.ADMIN_PUBLIC_KEY ||
            PrivateKey.fromBase58(senderPrivateKey).toPublicKey().toBase58(),
        ethProcessorAddress: process.env.ETH_PROCESSOR_ADDRESS,
        txFee: Number(process.env.TX_FEE || 0.1),
        mock: mock,
    };

    logger.log('config', config);

    logger.log(`Configuration loaded: {
            network: ${network},
            networkUrl: ${config.networkUrl},
            adminPublicKey: ${config.adminPublicKey},
            ethProcessorAddress: ${
                config.ethProcessorAddress || 'Will generate random'
            },
            txFee: ${config.txFee}
        }`);

    // Log private keys (warning: sensitive information)
    logger.log('Private Keys (keep secure):');
    logger.log(`Sender: ${senderPrivateKey}`);
    logger.log(`Token Controller: ${noriTokenControllerPrivateKey}`);
    logger.log(`Token Base: ${tokenBasePrivateKey}`);

    let ethProcessorAddress: string = config.ethProcessorAddress;
    if (!ethProcessorAddress) {
        logger.log('Inventing a random eth processor address.');
        ethProcessorAddress = PrivateKey.random().toPublicKey().toBase58();
    }

    logger.log('Constructing and compiling token deployer worker.');
    const TokenDeployerWorker = getTokenDeployerWorker();
    const tokenDeployer = new TokenDeployerWorker();
    const {
        noriStorageInterfaceVerificationKeySafe,
        noriTokenControllerVerificationKeySafe,
        fungibleTokenVerificationKeySafe,
    } = await tokenDeployer.compile();

    logger.log('Calling minaSetup.');
    await tokenDeployer.minaSetup({
        networkId: network,
        mina: networkUrl,
    });

    let tokenBaseAddress: string;
    let noriTokenControllerAddress: string;
    let tokenBaseTokenId: string;
    let noriTokenControllerTokenId: string;
    let txHash: string;

    if (keysWereCreated) {
        // New deployment mode
        logger.log('Deploying contracts...');
        const result = await tokenDeployer.deployContracts(
            config.senderPrivateKey,
            config.adminPublicKey,
            config.noriTokenControllerPrivateKey,
            config.tokenBasePrivateKey,
            ethProcessorAddress,
            noriStorageInterfaceVerificationKeySafe,
            0.1 * 1e9,
            {
                symbol: 'nETH',
                decimals: 6,
                allowUpdates: true,
            }
        );
        tokenBaseAddress = result.tokenBaseAddress;
        noriTokenControllerAddress = result.noriTokenControllerAddress;
        tokenBaseTokenId = result.tokenBaseTokenId;
        noriTokenControllerTokenId = result.noriTokenControllerTokenId;
        txHash = result.txHash;
    } else {
        // VK update mode
        logger.log('Updating verification keys...');

        // Require contract addresses for VK update
        if (!process.env.NORI_TOKEN_CONTROLLER_ADDRESS || !process.env.TOKEN_BASE_ADDRESS) {
            throw new Error(
                'VK update mode requires NORI_TOKEN_CONTROLLER_ADDRESS and TOKEN_BASE_ADDRESS environment variables'
            );
        }

        const result = await tokenDeployer.updateVerificationKeys(
            config.senderPrivateKey,
            process.env.NORI_TOKEN_CONTROLLER_ADDRESS,
            process.env.TOKEN_BASE_ADDRESS,
            noriTokenControllerVerificationKeySafe,
            fungibleTokenVerificationKeySafe,
            0.1 * 1e9
        );
        tokenBaseAddress = result.tokenBaseAddress;
        noriTokenControllerAddress = result.noriTokenControllerAddress;
        tokenBaseTokenId = result.tokenBaseTokenId;
        noriTokenControllerTokenId = result.noriTokenControllerTokenId;
        txHash = result.txHash;
    }

    const operationType = keysWereCreated ? 'Deployment' : 'Verification key update';
    logger.log(`🎉 ${operationType} completed successfully!`);
    logger.log(`Contract addresses/public keys:
            NoriTokenController: ${noriTokenControllerAddress},
            TokenBase: ${tokenBaseAddress},
            TokenBase Token ID: ${tokenBaseTokenId},
            NoriTokenController Token ID: ${noriTokenControllerTokenId},
            TransactionHash: ${txHash}
            `);

    // Print environment variables for future use
    logger.log('\n📋 Environment variables for future use:');
    logger.log(`NORI_TOKEN_CONTROLLER_ADDRESS=${noriTokenControllerAddress}`);
    logger.log(`TOKEN_BASE_ADDRESS=${tokenBaseAddress}`);
    logger.log(`TOKEN_BASE_TOKEN_ID=${tokenBaseTokenId}`);
    logger.log(`NORI_TOKEN_CONTROLLER_TOKEN_ID=${noriTokenControllerTokenId}`);
    logger.log(`ADMIN_PUBLIC_KEY=${config.adminPublicKey}`);

    // Write env file if keys were created during this deployment
    if (keysWereCreated) {
        writeSuccessDetailsToEnvFile(
            noriTokenControllerPrivateKey,
            noriTokenControllerAddress,
            tokenBasePrivateKey,
            tokenBaseAddress,
            config.adminPublicKey,
            tokenBaseTokenId,
            noriTokenControllerTokenId
        );
    }

    return {
        tokenBaseAddress,
        noriTokenControllerAddress,
    };
}
