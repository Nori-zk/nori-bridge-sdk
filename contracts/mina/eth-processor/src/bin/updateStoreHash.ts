// Load environment variables from .env file
import 'dotenv/config';
// Other imports
import {
    Mina,
    PrivateKey,
    NetworkId,
    fetchAccount,
    Bytes,
} from 'o1js';
import { Logger, LogPrinter } from '@nori-zk/proof-conversion';
import { compileAndVerifyContracts } from '../utils.js';
import { EthProcessor } from '../ethProcessor.js';
import { Bytes32, Bytes32FieldPair } from '@nori-zk/o1js-zk-programs';

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

// Get zkAppPrivateKey
if (!process.env.ZKAPP_PRIVATE_KEY) {
    logger.fatal('ZKAPP_PRIVATE_KEY not set.');
    process.exit(1);
}
let zkAppPrivateKeyBase58 = process.env.ZKAPP_PRIVATE_KEY as string;

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

// Get cli argument
const storeHashHex = process.argv[2];
console.log('storeHashHex', storeHashHex);

let storeHash: Bytes;
try {
    const possibleStoreHash = storeHashHex
        ? Bytes32.fromHex(storeHashHex)
        : undefined;
    if (possibleStoreHash === undefined)
        throw new Error('Store hash hex value was not defined. Please provide it as a first argument.');
    storeHash = possibleStoreHash;
} catch (err) {
    logger.fatal(
        `Store hash was not provided as a first argument or was invalid:\n${(err as Error).stack}`
    );
    process.exit(1);
}

async function updateStoreHash() {
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
    await compileAndVerifyContracts(logger);

    // Initialize contract
    const zkApp = new EthProcessor(zkAppAddress);

    // Deploy transaction
    logger.log('Creating deployment transaction...');
    const txn = await Mina.transaction(
        { fee, sender: deployerAccount },
        async () => {
            logger.log(`Updating the store hash to '${storeHashHex}'.`);
            await zkApp.updateStoreHash(
                Bytes32FieldPair.fromBytes32(storeHash)
            );
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
    logger.log('Update successful!');
    logger.log(`Contract admin: '${currentAdmin?.toBase58()}'.`);
}

// Execute update
updateStoreHash().catch((err) => {
    logger.fatal(`Deploy function encountered an error.\n${String(err)}`);
    process.exit(1);
});
