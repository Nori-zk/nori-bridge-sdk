// Load environment variables from .env file
import 'dotenv/config';
// Other imports
import { Mina, PrivateKey, type NetworkId, fetchAccount } from 'o1js';
import { Logger, LogPrinter } from 'esm-iso-logger';
import { NoriTokenBridge } from '../NoriTokenBridge.js';
import { NoriStorageInterface } from '../NoriStorageInterface.js';
import { FungibleToken } from '../TokenBase.js';
import {
    Bytes32,
    Bytes32FieldPair,
    compileAndVerifyContracts,
} from '@nori-zk/o1js-zk-utils-new';
import { noriTokenBridgeVkHash } from '../integrity/NoriTokenBridge.VkHash.js';
import { noriStorageInterfaceVkHash } from '../integrity/NoriStorageInterface.VkHash.js';
import { fungibleTokenVkHash } from '../integrity/FungibleToken.VkHash.js';

const logger = new Logger('UpdateStoreHash');

new LogPrinter('NoriTokenBridge');

// Collect all inputs upfront
const possibleNetworkUrl = process.env.MINA_RPC_NETWORK_URL;
const possibleNetwork = process.env.MINA_NETWORK;
const possibleAdminKeyBase58 = process.env.MINA_SENDER_PRIVATE_KEY;
const possibleTokenBridgeKeyBase58 = process.env.NORI_MINA_TOKEN_BRIDGE_PRIVATE_KEY;
const fee = Number(process.env.MINA_TX_FEE || 0.1) * 1e9;
const possibleStoreHashHex = process.argv[2];

// Validate everything in one pass
const issues: string[] = [];

if (!possibleNetworkUrl)
    issues.push('Missing required env: MINA_RPC_NETWORK_URL');
if (!possibleNetwork) issues.push('Missing required env: MINA_NETWORK');
if (!possibleAdminKeyBase58)
    issues.push('Missing required env: MINA_SENDER_PRIVATE_KEY (must be the contract admin private key)');
if (!possibleTokenBridgeKeyBase58)
    issues.push('Missing required env: NORI_MINA_TOKEN_BRIDGE_PRIVATE_KEY');
if (!possibleStoreHashHex)
    issues.push('Missing required first argument: storeHashHex');

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
    !isPrivateKey(possibleAdminKey) ||
    !isPrivateKey(possibleTokenBridgeKey) ||
    !isBytes32(possibleStoreHash) ||
    !isString(possibleNetworkUrl) ||
    !isString(possibleNetwork)
) {
    logger.fatal('Internal error: required values undefined after validation.');
    process.exit(1);
}

const adminKey = possibleAdminKey;
const tokenBridgePrivateKey = possibleTokenBridgeKey;
const storeHash = possibleStoreHash;
const networkUrl = possibleNetworkUrl;
const networkId: NetworkId =
    possibleNetwork === 'mainnet' ? 'mainnet' : 'testnet';

logger.log(`storeHashHex provided: '${possibleStoreHashHex}'`);

async function updateStoreHash() {
    const adminAccount = adminKey.toPublicKey();
    const tokenBridgeAddress = tokenBridgePrivateKey.toPublicKey();
    logger.log(`Admin address: '${adminAccount.toBase58()}'.`);
    logger.log(`NoriTokenBridge address: '${tokenBridgeAddress.toBase58()}'.`);

    const Network = Mina.Network({ networkId, mina: networkUrl });
    Mina.setActiveInstance(Network);

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

    logger.log('Creating update store hash transaction...');
    const txn = await Mina.transaction(
        { fee, sender: adminAccount },
        async () => {
            logger.log(`Updating the store hash to '${possibleStoreHashHex}'.`);
            await tokenBridge.updateStoreHash(Bytes32FieldPair.fromBytes32(storeHash));
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
    logger.log('Update successful!');
}

updateStoreHash().catch((err) => {
    logger.fatal(
        `UpdateStoreHash function encountered an error.\n${String(err)}`
    );
    process.exit(1);
});
