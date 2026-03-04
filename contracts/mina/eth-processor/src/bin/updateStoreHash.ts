// Load environment variables from .env file
import 'dotenv/config';
// Other imports
import { Mina, PrivateKey, type NetworkId, fetchAccount } from 'o1js';
import { Logger, LogPrinter } from 'esm-iso-logger';
import { EthProcessor } from '../ethProcessor.js';
import {
    Bytes32,
    Bytes32FieldPair,
    compileAndVerifyContracts,
    EthVerifier,
    ethVerifierVkHash,
} from '@nori-zk/o1js-zk-utils';
import { ethProcessorVkHash } from '../integrity/EthProcessor.VKHash.js';

const logger = new Logger('UpdateStoreHash');

new LogPrinter('NoriEthProcessor');

// Collect all inputs upfront
const possibleNetworkUrl = process.env.MINA_RPC_NETWORK_URL;
const possibleNetwork = process.env.NETWORK;
const possibleDeployerKeyBase58 = process.env.SENDER_PRIVATE_KEY;
const possibleZkAppKeyBase58 = process.env.ZKAPP_PRIVATE_KEY;
const fee = Number(process.env.TX_FEE || 0.1) * 1e9; // in nanomina (1 billion = 1.0 mina)
const possibleStoreHashHex = process.argv[2];

// Validate everything in one pass
const issues: string[] = [];

if (!possibleNetworkUrl)
    issues.push('Missing required env: MINA_RPC_NETWORK_URL');
if (!possibleNetwork) issues.push('Missing required env: NETWORK');
if (!possibleDeployerKeyBase58)
    issues.push('Missing required env: SENDER_PRIVATE_KEY');
if (!possibleZkAppKeyBase58)
    issues.push('Missing required env: ZKAPP_PRIVATE_KEY');
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

if (issues.length) {
    const formatted = [
        'UpdateStoreHash encountered issues:',
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
function isString(val: string | undefined): val is string {
    return val !== undefined;
}

if (
    !isPrivateKey(possibleDeployerKey) ||
    !isPrivateKey(possibleZkAppKey) ||
    !isBytes32(possibleStoreHash) ||
    !isString(possibleNetworkUrl) ||
    !isString(possibleNetwork)
) {
    logger.fatal('Internal error: required values undefined after validation.');
    process.exit(1);
}

const deployerKey = possibleDeployerKey;
const zkAppPrivateKey = possibleZkAppKey;
const storeHash = possibleStoreHash;
const networkUrl = possibleNetworkUrl;
const networkId: NetworkId =
    possibleNetwork === 'mainnet' ? 'mainnet' : 'testnet';

logger.log(`storeHashHex provided: '${possibleStoreHashHex}'`);

async function updateStoreHash() {
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

    logger.log('Creating update store hash transaction...');
    const txn = await Mina.transaction(
        { fee, sender: deployerAccount },
        async () => {
            logger.log(`Updating the store hash to '${possibleStoreHashHex}'.`);
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
    logger.fatal(
        `UpdateStoreHash function encountered an error.\n${String(err)}`
    );
    process.exit(1);
});
