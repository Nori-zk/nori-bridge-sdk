// Load environment variables from .env file
import 'dotenv/config';
// Other imports
import { Mina, PrivateKey, type NetworkId, fetchAccount } from 'o1js';
import { Logger, LogPrinter } from 'esm-iso-logger';
import { readFileSync } from 'fs';
import { EthProcessor } from '../ethProcessor.js';
import {
    compileAndVerifyContracts,
    EthVerifier,
    ethVerifierVkHash,
    type VerificationKeySafe,
    vkSafeToVk,
} from '@nori-zk/o1js-zk-utils';
import { ethProcessorVkHash } from '../integrity/EthProcessor.VKHash.js';

const logger = new Logger('UpdateVk');

new LogPrinter('NoriEthProcessor');

// Collect all inputs upfront
const possibleNetworkUrl = process.env.MINA_RPC_NETWORK_URL;
const possibleNetwork = process.env.NETWORK;
const possibleDeployerKeyBase58 = process.env.SENDER_PRIVATE_KEY;
const possibleZkAppKeyBase58 = process.env.ZKAPP_PRIVATE_KEY;
const fee = Number(process.env.TX_FEE || 0.1) * 1e9; // in nanomina (1 billion = 1.0 mina)
const possibleVkDataFilePath = process.argv[2];
const possibleVkHashFilePath = process.argv[3];

// Validate everything in one pass
const issues: string[] = [];

if (!possibleNetworkUrl)
    issues.push('Missing required env: MINA_RPC_NETWORK_URL');
if (!possibleNetwork) issues.push('Missing required env: NETWORK');
if (!possibleDeployerKeyBase58)
    issues.push('Missing required env: SENDER_PRIVATE_KEY');
if (!possibleZkAppKeyBase58)
    issues.push('Missing required env: ZKAPP_PRIVATE_KEY');
if (!possibleVkDataFilePath)
    issues.push('Missing required first argument: path to new VkData.json');
if (!possibleVkHashFilePath)
    issues.push('Missing required second argument: path to new VkHash.json');

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

let possibleZkAppKey: PrivateKey | undefined;
if (possibleZkAppKeyBase58) {
    try {
        possibleZkAppKey = PrivateKey.fromBase58(possibleZkAppKeyBase58);
    } catch (e) {
        issues.push(
            `ZKAPP_PRIVATE_KEY is not a valid private key: ${(e as Error).message}`
        );
    }
}

let possibleVkSafe: VerificationKeySafe | undefined;
if (possibleVkDataFilePath && possibleVkHashFilePath) {
    try {
        const data = JSON.parse(
            readFileSync(possibleVkDataFilePath, 'utf8')
        ) as string;
        const hashStr = JSON.parse(
            readFileSync(possibleVkHashFilePath, 'utf8')
        ) as string;
        possibleVkSafe = { data, hashStr };
    } catch (e) {
        issues.push(
            `Failed to read VK integrity files: ${(e as Error).message}`
        );
    }
}

if (issues.length) {
    const formatted = [
        'UpdateVk encountered issues:',
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
function isString(val: string | undefined): val is string {
    return val !== undefined;
}
function isVkSafe(
    val: VerificationKeySafe | undefined
): val is VerificationKeySafe {
    return val !== undefined;
}

if (
    !isPrivateKey(possibleDeployerKey) ||
    !isPrivateKey(possibleZkAppKey) ||
    !isString(possibleNetworkUrl) ||
    !isString(possibleNetwork) ||
    !isVkSafe(possibleVkSafe)
) {
    logger.fatal('Internal error: required values undefined after validation.');
    process.exit(1);
}

const deployerKey = possibleDeployerKey;
const zkAppPrivateKey = possibleZkAppKey;
const networkUrl = possibleNetworkUrl;
const networkId: NetworkId =
    possibleNetwork === 'mainnet' ? 'mainnet' : 'testnet';
const newVkHashStr = possibleVkSafe.hashStr;
const newVerificationKey = vkSafeToVk(possibleVkSafe);

logger.log(`New VK hash: '${newVkHashStr}'`);
logger.log(`VkData file: '${possibleVkDataFilePath}'`);
logger.log(`VkHash file: '${possibleVkHashFilePath}'`);

async function updateVk() {
    const deployerAccount = deployerKey.toPublicKey();
    const zkAppAddress = zkAppPrivateKey.toPublicKey();
    const zkAppAddressBase58 = zkAppAddress.toBase58();
    logger.log(`Deployer (admin) address: '${deployerAccount.toBase58()}'.`);
    logger.log(`ZkApp contract address: '${zkAppAddressBase58}'.`);

    // Configure Mina network
    const Network = Mina.Network({
        networkId,
        mina: networkUrl,
    });
    Mina.setActiveInstance(Network);

    // Compile the current (old) contract and verify it matches the local integrity hashes.
    // The proof is generated using the old circuit — the new VK is passed as an argument.
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

    const zkApp = new EthProcessor(zkAppAddress);

    logger.log('Creating update VK transaction...');
    const txn = await Mina.transaction(
        { fee, sender: deployerAccount },
        async () => {
            logger.log(
                `Setting new verification key with hash: '${newVkHashStr}'`
            );
            await zkApp.setVerificationKey(newVerificationKey);
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
    logger.log('VK update successful!');
    logger.log(`Contract admin: '${currentAdmin?.toBase58()}'.`);
}

// Execute VK update
updateVk().catch((err) => {
    logger.fatal(`UpdateVk function encountered an error.\n${String(err)}`);
    process.exit(1);
});
