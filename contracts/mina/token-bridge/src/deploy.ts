import 'dotenv/config';
import { PrivateKey } from 'o1js';
import { getTokenDeployerWorker } from './workers/tokenDeployer/node/parent.js';
import { Logger } from 'esm-iso-logger';

const logger = new Logger('DeployTokenController');

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
    const { noriStorageInterfaceVerificationKeySafe } =
        await tokenDeployer.compile();

    logger.log('Calling minaSetup.');
    await tokenDeployer.minaSetup({
        networkId: network,
        mina: networkUrl,
    });

    logger.log('Deploying contract.');
    const { tokenBaseAddress, noriTokenControllerAddress, txHash } =
        await tokenDeployer.deployContracts(
            config.senderPrivateKey, //contractSenderPrivateKeyBase58,
            config.adminPublicKey, // contractSenderPrivateKeyBase58, // Admin
            config.noriTokenControllerPrivateKey, //tokenControllerPrivateKey.toBase58(),
            config.tokenBasePrivateKey, // tokenBasePrivateKey.toBase58(),
            ethProcessorAddress, //ethProcessorAddress,
            noriStorageInterfaceVerificationKeySafe,
            0.1 * 1e9,
            {
                symbol: 'nETH',
                decimals: 6,
                allowUpdates: true,
            }
        );

    logger.log('🎉 Deployment completed successfully!');
    logger.log(`Contract addresses/public keys:
            NoriTokenController: ${noriTokenControllerAddress},
            TokenBase: ${tokenBaseAddress},
            TransactionHash: ${txHash}
            `);

    // Print environment variables for easy setup
    logger.log('\n📋 Environment variables for future use:');
    logger.log(`NORI_TOKEN_CONTROLLER_ADDRESS=${noriTokenControllerAddress}`);
    logger.log(`TOKEN_BASE_ADDRESS=${tokenBaseAddress}`);
    logger.log(`ADMIN_PUBLIC_KEY=${config.adminPublicKey}`);

    return {
        tokenBaseAddress,
        noriTokenControllerAddress,
    };
}
