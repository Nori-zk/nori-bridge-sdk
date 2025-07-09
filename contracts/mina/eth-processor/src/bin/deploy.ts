// Load environment variables from .env file
import 'dotenv/config';
// Other imports
import { Mina, PrivateKey, AccountUpdate, NetworkId, fetchAccount } from 'o1js';
import { Logger, LogPrinter } from '@nori-zk/proof-conversion';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { rootDir } from '../utils.js';
import { EthProcessor } from '../ethProcessor.js';
import {
    compileAndVerifyContracts,
    EthVerifier,
    ethVerifierVkHash,
} from '@nori-zk/o1js-zk-utils';
import { ethProcessorVkHash } from '../integrity/EthProcessor.VKHash.js';

const logger = new Logger('Deploy');

new LogPrinter('[NoriEthProcessor]', [
    'log',
    'info',
    'warn',
    'error',
    'debug',
    'fatal',
    'verbose',
]);

const missingEnvVariables: string[] = [];

// Declare sender private key
const deployerKeyBase58 = process.env.SENDER_PRIVATE_KEY as string;

// Get or generate a zkAppPrivateKey
let zkAppPrivateKeyWasCreated = false;
if (!process.env.ZKAPP_PRIVATE_KEY) {
    zkAppPrivateKeyWasCreated = true;
    logger.log('ZKAPP_PRIVATE_KEY not set, generating a random key.');
}
let zkAppPrivateKeyBase58 =
    process.env.ZKAPP_PRIVATE_KEY ?? PrivateKey.random().toBase58();
if (zkAppPrivateKeyWasCreated) {
    logger.log(`Created a new ZKAppPrivate key.`);
    process.env.ZKAPP_PRIVATE_KEY = zkAppPrivateKeyBase58;
}

// Validate
if (!deployerKeyBase58) missingEnvVariables.push('SENDER_PRIVATE_KEY');
if (!zkAppPrivateKeyBase58) missingEnvVariables.push('ZKAPP_PRIVATE_KEY');
if (missingEnvVariables.length > 0) {
    logger.fatal(
        `Missing required environment variable(s): ${missingEnvVariables.join(
            ' and '
        )}`
    );
    process.exit(1);
}

// Network configuration
const networkUrl =
    process.env.MINA_RPC_NETWORK_URL || 'http://localhost:3000/graphql'; // Should probably validate here the network type. FIXME
const fee = Number(process.env.TX_FEE || 0.1) * 1e9; // in nanomina (1 billion = 1.0 mina)

function writeSuccessDetailsToEnvFileFile(zkAppAddressBase58: string) {
    // Write env file.
    const env = {
        ZKAPP_PRIVATE_KEY: zkAppPrivateKeyBase58,
        ZKAPP_ADDRESS: zkAppAddressBase58,
    };
    const envFileStr =
        Object.entries(env)
            .map(([key, value]) => `${key}=${value}`)
            .join('\n') + `\n`;
    const envFileOutputPath = resolve(
        rootDir,
        '..',
        '..',
        '.env.nori-eth-processor'
    );
    logger.info(`Writing env file with the details: '${envFileOutputPath}'`);
    writeFileSync(envFileOutputPath, envFileStr, 'utf8');
    logger.log(`Wrote '${envFileOutputPath}' successfully.`);
}

async function deploy() {
    // Initialize keys
    const deployerKey = PrivateKey.fromBase58(deployerKeyBase58);
    const zkAppPrivateKey = PrivateKey.fromBase58(zkAppPrivateKeyBase58);
    const deployerAccount = deployerKey.toPublicKey();
    const zkAppAddress = zkAppPrivateKey.toPublicKey();
    const zkAppAddressBase58 = zkAppAddress.toBase58();

    logger.log(`Deployer address: '${deployerAccount.toBase58()}'.`);
    logger.log(`ZkApp contract address: '${zkAppAddressBase58}'.`);

    // Configure Mina network
    const Network = Mina.Network({
        networkId: 'testnet' as NetworkId,
        mina: networkUrl,
    });
    Mina.setActiveInstance(Network);

    // Compile and verify
    const { ethProcessorVerificationKey } =
        await compileAndVerifyContracts(logger, [
            {
                name: 'ethVerifier',
                program: EthVerifier,
                integrityHash: ethVerifierVkHash,
            },
            {
                name: 'ethProcessor',
                program: EthProcessor,
                integrityHash: ethProcessorVkHash,
            },
        ]);

    // Initialize contract
    const zkApp = new EthProcessor(zkAppAddress);

    // Deploy transaction
    logger.log('Creating deployment transaction...');
    const txn = await Mina.transaction(
        { fee, sender: deployerAccount },
        async () => {
            if (zkAppPrivateKeyWasCreated)
                AccountUpdate.fundNewAccount(deployerAccount);
            logger.log('Deploying with an updated verification key.');
            await zkApp.deploy({
                verificationKey: ethProcessorVerificationKey,
            });
        }
    );

    logger.log('Proving transaction');
    await txn.prove();
    const signedTx = txn.sign([deployerKey, zkAppPrivateKey]);
    logger.log('Sending transaction...');
    const pendingTx = await signedTx.send();
    logger.log('Waiting for transaction to be included in a block...');
    await pendingTx.wait();

    await fetchAccount({ publicKey: zkAppAddress });
    const currentAdmin = await zkApp.admin.fetch();
    logger.log('Deployment successful!');
    logger.log(`Contract admin: '${currentAdmin?.toBase58()}'.`);

    writeSuccessDetailsToEnvFileFile(zkAppAddressBase58);
}

// Execute deployment
deploy().catch((err) => {
    logger.fatal(`Deploy function encountered an error.\n${String(err)}`);
    process.exit(1);
});
