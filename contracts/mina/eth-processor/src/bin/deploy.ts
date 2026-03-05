// Load environment variables from .env file
import 'dotenv/config';
// Other imports
import {
    Mina,
    PrivateKey,
    PublicKey,
    AccountUpdate,
    type NetworkId,
    fetchAccount,
} from 'o1js';
import { Logger, LogPrinter } from 'esm-iso-logger';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { rootDir } from '../utils.js';
import { EthProcessor } from '../ethProcessor.js';
import {
    Bytes32,
    Bytes32FieldPair,
    compileAndVerifyContracts,
    EthVerifier,
    ethVerifierVkHash,
} from '@nori-zk/o1js-zk-utils-new';
import { ethProcessorVkHash } from '../integrity/EthProcessor.VKHash.js';

const logger = new Logger('Deploy');

new LogPrinter('NoriEthProcessor');

// Collect all inputs upfront
const possibleNetworkUrl = process.env.MINA_RPC_NETWORK_URL;
const possibleNetwork = process.env.NETWORK;
const possibleDeployerKeyBase58 = process.env.SENDER_PRIVATE_KEY;
const fee = Number(process.env.TX_FEE || 0.1) * 1e9; // in nanomina (1 billion = 1.0 mina)
const possibleStoreHashHex = process.argv[2];
const possibleAdminPublicKeyBase58 = process.argv[3];

// Validate everything in one pass
const issues: string[] = [];

if (!possibleNetworkUrl)
    issues.push('Missing required env: MINA_RPC_NETWORK_URL');
if (!possibleNetwork) issues.push('Missing required env: NETWORK');
if (!possibleDeployerKeyBase58)
    issues.push('Missing required env: SENDER_PRIVATE_KEY');
if (process.env.ZKAPP_PRIVATE_KEY)
    issues.push(
        'ZKAPP_PRIVATE_KEY must not be set for initial deployment — this script generates a random key. Remove it.'
    );
if (!possibleStoreHashHex)
    issues.push('Missing required first argument: storeHashHex');

let possibleDeployerKey: PrivateKey | undefined;
if (possibleDeployerKeyBase58) {
    try {
        possibleDeployerKey = PrivateKey.fromBase58(possibleDeployerKeyBase58);
    } catch (e) {
        issues.push(
            `SENDER_PRIVATE_KEY is not a valid private key: ${(e as Error).message}`
        );
    }
}

let possibleStoreHash: Bytes32 | undefined;
if (possibleStoreHashHex) {
    try {
        possibleStoreHash = Bytes32.fromHex(possibleStoreHashHex);
    } catch (e) {
        issues.push(
            `storeHashHex '${possibleStoreHashHex}' is not a valid 32-byte hex string: ${(e as Error).message}`
        );
    }
}

let possibleAdminPublicKey: PublicKey | undefined;
if (possibleAdminPublicKeyBase58) {
    try {
        possibleAdminPublicKey = PublicKey.fromBase58(
            possibleAdminPublicKeyBase58
        );
    } catch (e) {
        issues.push(
            `adminPublicKeyBase58 argument '${possibleAdminPublicKeyBase58}' is not a valid public key: ${(e as Error).message}`
        );
    }
}

if (issues.length) {
    const formatted = [
        'Deploy encountered issues:',
        ...issues.flatMap((issue, idx) => {
            const lines = issue.split('\n');
            return lines.map((line, lineIdx) =>
                lineIdx === 0 ? `\t${idx + 1}: ${line}` : `\t   ${line}`
            );
        }),
    ].join('\n');
    logger.fatal(formatted);
    process.exit(1);
}

// Type guards — all required values are guaranteed defined after the issues exit above
function isPrivateKey(val: PrivateKey | undefined): val is PrivateKey {
    return val !== undefined;
}
function isBytes32(val: Bytes32 | undefined): val is Bytes32 {
    return val !== undefined;
}
function isPublicKey(val: PublicKey | undefined): val is PublicKey {
    return val !== undefined;
}
function isString(val: string | undefined): val is string {
    return val !== undefined;
}

if (
    !isPrivateKey(possibleDeployerKey) ||
    !isBytes32(possibleStoreHash) ||
    !isString(possibleNetworkUrl) ||
    !isString(possibleNetwork)
) {
    logger.fatal('Internal error: required values undefined after validation.');
    process.exit(1);
}

const deployerKey = possibleDeployerKey;
const storeHash = possibleStoreHash;
const networkUrl = possibleNetworkUrl;
const networkId: NetworkId =
    possibleNetwork === 'mainnet' ? 'mainnet' : 'testnet';

// Generate zkApp key and resolve adminPublicKey
const zkAppPrivateKey = PrivateKey.random();
const zkAppPrivateKeyBase58 = zkAppPrivateKey.toBase58();

let adminPublicKey: PublicKey;
if (isPublicKey(possibleAdminPublicKey)) {
    logger.log(
        `adminPublicKeyBase58 provided: '${possibleAdminPublicKeyBase58}'`
    );
    adminPublicKey = possibleAdminPublicKey;
} else {
    logger.warn(
        'No adminPublicKeyBase58 provided as second argument. Defaulting to the public key derived from SENDER_PRIVATE_KEY.'
    );
    adminPublicKey = deployerKey.toPublicKey();
}

logger.log(`storeHashHex provided: '${possibleStoreHashHex}'`);

// Util to save ZKAPP_PRIVATE_KEY and ZKAPP_ADDRESS to a file.
function writeSuccessDetailsToEnvFileFile(zkAppAddressBase58: string) {
    const env = {
        ZKAPP_PRIVATE_KEY: zkAppPrivateKeyBase58,
        ZKAPP_ADDRESS: zkAppAddressBase58,
    };
    const envFileStr =
        Object.entries(env)
            .map(([key, value]) => `${key}=${value}`)
            .join('\n') + `\n`;
    const envFileOutputPath = resolve(rootDir, '..', '.env.nori-eth-processor');
    logger.info(`Writing env file with the details: '${envFileOutputPath}'`);
    writeFileSync(envFileOutputPath, envFileStr, 'utf8');
    logger.log(`Wrote '${envFileOutputPath}' successfully.`);
}

async function deploy() {
    // Gather keys
    const deployerAccount = deployerKey.toPublicKey();
    const zkAppAddress = zkAppPrivateKey.toPublicKey();
    const zkAppAddressBase58 = zkAppAddress.toBase58();
    logger.log(`Deployer address: '${deployerAccount.toBase58()}'.`);
    logger.log(`ZkApp contract address: '${zkAppAddressBase58}'.`);

    // Configure Mina network
    const Network = Mina.Network({
        networkId,
        mina: networkUrl,
    });
    Mina.setActiveInstance(Network);

    // Compile and verify
    const { ethProcessorVerificationKey } = await compileAndVerifyContracts(
        logger,
        [
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
        ]
    );

    // Initialize contract
    const zkApp = new EthProcessor(zkAppAddress);

    // Deploy transaction
    logger.log(`Creating deployment transaction...`);
    const txn = await Mina.transaction(
        { fee, sender: deployerAccount },
        async () => {
            logger.log(
                `Deploying smart contract with verification key hash: '${ethProcessorVerificationKey.hash}'`
            );
            AccountUpdate.fundNewAccount(deployerAccount);
            await zkApp.deploy({
                verificationKey: ethProcessorVerificationKey,
            });
            logger.log(
                `Initializing with adminPublicKey '${adminPublicKey.toBase58()}' and store hash '${storeHash.toHex()}'.`
            );
            await zkApp.initialize(
                adminPublicKey,
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
    logger.log('Deployment successful!');
    logger.log(`Contract admin: '${currentAdmin?.toBase58()}'.`);

    writeSuccessDetailsToEnvFileFile(zkAppAddressBase58);
}

// Execute deployment
deploy().catch((err) => {
    logger.fatal(`Deploy function encountered an error.\n${String(err)}`);
    process.exit(1);
});
