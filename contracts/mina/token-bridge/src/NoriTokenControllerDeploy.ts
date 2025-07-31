import 'dotenv/config';
import { Lightnet, PrivateKey } from 'o1js';
import {
    NoriTokenControllerSubmitter,
    NoriTokenControllerConfig,
} from './NoriControllerSubmitter.js';

export async function main() {
    console.log('Deploying Nori Token Controller...');
    const defaultLightnetUrl = 'http://localhost:8080/graphql';
    const networkUrl = process.env.MINA_RPC_NETWORK_URL || defaultLightnetUrl;
    const network =
        networkUrl.includes('localhost') || networkUrl.includes('devnet')
            ? 'testnet'
            : 'mainnet';

    console.log(`🚀 Starting deployment to ${network}`);
    // Configuration
    // Get or generate sender private key
    let senderPrivateKey = process.env.SENDER_PRIVATE_KEY;

    if (!senderPrivateKey) {
        if (networkUrl.includes('localhost')) {
            senderPrivateKey = (
                await Lightnet.acquireKeyPair({
                    lightnetAccountManagerEndpoint: 'http://localhost:8181',
                })
            ).privateKey.toBase58();
        } else {
            throw new Error(
                'SENDER_PRIVATE_KEY environment variable is required for non-local deployments'
            );
        }
    }
    const noriTokenControllerPrivateKey =
        process.env.NORI_CONTROLLER_PRIVATE_KEY ||
        PrivateKey.random().toBase58();
    const tokenBasePrivateKey =
        process.env.TOKEN_BASE_PRIVATE_KEY || PrivateKey.random().toBase58();


    // Determine if we are a mock
    const mock = !!process.env.MOCK;
    
    // Create the config with the saved variables
    const config: NoriTokenControllerConfig = {
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
        mock: mock
    };

    // // Network variable for deployment info
    // const network = process.env.NETWORK || 'lightnet';

    console.log(`Configuration loaded: {
            network: ${network},
            networkUrl: ${config.networkUrl},
            adminPublicKey: ${config.adminPublicKey},
            ethProcessorAddress: ${
                config.ethProcessorAddress || 'Will generate random'
            },
            txFee: ${config.txFee}
        }`);

    // Log private keys (warning: sensitive information)
    console.log('Private Keys (keep secure):');
    console.log(`Sender: ${senderPrivateKey}`);
    console.log(`Token Controller: ${noriTokenControllerPrivateKey}`);
    console.log(`Token Base: ${tokenBasePrivateKey}`);

    // Create submitter
    const submitter = new NoriTokenControllerSubmitter(config);

    // Setup network
    await submitter.networkSetUp();

    // Compile contracts
    await submitter.compileContracts();

    // Deploy contracts
    const deployResult = await submitter.deployContracts({
        symbol: 'nETH',
        decimals: 18,
        allowUpdates: true,
    });

    console.log('🎉 Deployment completed successfully!');
    console.log(`Contract addresses:
            NoriTokenController: ${deployResult.noriTokenControllerAddress},
            TokenBase: ${deployResult.tokenBaseAddress},
            TransactionHash: ${deployResult.txHash}
            `);

    // Print environment variables for easy setup
    console.log('\n📋 Environment variables for future use:');
    console.log(
        `NORI_TOKEN_CONTROLLER_ADDRESS=${deployResult.noriTokenControllerAddress}`
    );
    console.log(`TOKEN_BASE_ADDRESS=${deployResult.tokenBaseAddress}`);
    console.log(`ADMIN_PUBLIC_KEY=${config.adminPublicKey}`);
}
