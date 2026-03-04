// Load environment variables from .env file
import 'dotenv/config';
// Other imports
import { Mina, PrivateKey, type NetworkId, fetchAccount } from 'o1js';
import { Logger, LogPrinter } from 'esm-iso-logger';
import { readFileSync } from 'fs';
import { NoriTokenBridge } from '../NoriTokenBridge.js';
import { NoriStorageInterface } from '../NoriStorageInterface.js';
import { FungibleToken } from '../TokenBase.js';
import {
    compileAndVerifyContracts,
    type VerificationKeySafe,
    vkSafeToVk,
} from '@nori-zk/o1js-zk-utils';
import { noriTokenBridgeVkHash } from '../integrity/NoriTokenBridge.VkHash.js';
import { noriStorageInterfaceVkHash } from '../integrity/NoriStorageInterface.VkHash.js';
import { fungibleTokenVkHash } from '../integrity/FungibleToken.VkHash.js';

const logger = new Logger('UpdateVk');

new LogPrinter('NoriTokenBridge');

// Collect all inputs upfront
const possibleNetworkUrl = process.env.MINA_RPC_NETWORK_URL;
const possibleNetwork = process.env.MINA_NETWORK;
const possibleAdminKeyBase58 = process.env.MINA_SENDER_PRIVATE_KEY;
const possibleTokenBridgeKeyBase58 = process.env.NORI_MINA_TOKEN_BRIDGE_PRIVATE_KEY;
const fee = Number(process.env.MINA_TX_FEE || 0.1) * 1e9;
const possibleVkDataFilePath = process.argv[2];
const possibleVkHashFilePath = process.argv[3];

// Validate everything in one pass
const issues: string[] = [];

if (!possibleNetworkUrl)
    issues.push('Missing required env: MINA_RPC_NETWORK_URL');
if (!possibleNetwork) issues.push('Missing required env: MINA_NETWORK');
if (!possibleAdminKeyBase58)
    issues.push('Missing required env: MINA_SENDER_PRIVATE_KEY (must be the contract admin private key)');
if (!possibleTokenBridgeKeyBase58)
    issues.push('Missing required env: NORI_MINA_TOKEN_BRIDGE_PRIVATE_KEY');
if (!possibleVkDataFilePath)
    issues.push('Missing required first argument: path to new VkData.json');
if (!possibleVkHashFilePath)
    issues.push('Missing required second argument: path to new VkHash.json');

let possibleAdminKey: PrivateKey | undefined;
if (possibleAdminKeyBase58) {
    try {
        possibleAdminKey = PrivateKey.fromBase58(possibleAdminKeyBase58);
    } catch (e) {
        issues.push(
            `MINA_SENDER_PRIVATE_KEY (contract admin) is not a valid private key: ${(e as Error).message}`
        );
    }
}

let possibleTokenBridgeKey: PrivateKey | undefined;
if (possibleTokenBridgeKeyBase58) {
    try {
        possibleTokenBridgeKey = PrivateKey.fromBase58(possibleTokenBridgeKeyBase58);
    } catch (e) {
        issues.push(
            `NORI_MINA_TOKEN_BRIDGE_PRIVATE_KEY is not a valid private key: ${(e as Error).message}`
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
    !isPrivateKey(possibleAdminKey) ||
    !isPrivateKey(possibleTokenBridgeKey) ||
    !isString(possibleNetworkUrl) ||
    !isString(possibleNetwork) ||
    !isVkSafe(possibleVkSafe)
) {
    logger.fatal('Internal error: required values undefined after validation.');
    process.exit(1);
}

const adminKey = possibleAdminKey;
const tokenBridgePrivateKey = possibleTokenBridgeKey;
const networkUrl = possibleNetworkUrl;
const networkId: NetworkId =
    possibleNetwork === 'mainnet' ? 'mainnet' : 'testnet';
const newVkHashStr = possibleVkSafe.hashStr;
const newVerificationKey = vkSafeToVk(possibleVkSafe);

logger.log(`New VK hash: '${newVkHashStr}'`);
logger.log(`VkData file: '${possibleVkDataFilePath}'`);
logger.log(`VkHash file: '${possibleVkHashFilePath}'`);

async function updateVk() {
    const adminAccount = adminKey.toPublicKey();
    const tokenBridgeAddress = tokenBridgePrivateKey.toPublicKey();
    logger.log(`Admin address: '${adminAccount.toBase58()}'.`);
    logger.log(`NoriTokenBridge address: '${tokenBridgeAddress.toBase58()}'.`);

    const Network = Mina.Network({ networkId, mina: networkUrl });
    Mina.setActiveInstance(Network);

    // Compile the current (old) contracts and verify against local integrity hashes.
    await compileAndVerifyContracts(logger, [
        {
            name: 'NoriStorageInterface',
            program: NoriStorageInterface,
            integrityHash: noriStorageInterfaceVkHash,
        },
        {
            name: 'FungibleToken',
            program: FungibleToken,
            integrityHash: fungibleTokenVkHash,
        },
        {
            name: 'NoriTokenBridge',
            program: NoriTokenBridge,
            integrityHash: noriTokenBridgeVkHash,
        },
    ]);

    const tokenBridge = new NoriTokenBridge(tokenBridgeAddress);

    logger.log('Creating update VK transaction...');
    const txn = await Mina.transaction(
        { fee, sender: adminAccount },
        async () => {
            logger.log(
                `Setting new verification key with hash: '${newVkHashStr}'`
            );
            await tokenBridge.updateVerificationKey(newVerificationKey);
        }
    );

    logger.log('Proving transaction');
    await txn.prove();
    const signedTx = txn.sign([adminKey, tokenBridgePrivateKey]);
    logger.log('Sending transaction...');
    const pendingTx = await signedTx.send();
    logger.log('Waiting for transaction to be included in a block...');
    await pendingTx.wait();

    await fetchAccount({ publicKey: tokenBridgeAddress });
    logger.log('VK update successful!');
}

updateVk().catch((err) => {
    logger.fatal(`UpdateVk function encountered an error.\n${String(err)}`);
    process.exit(1);
});
