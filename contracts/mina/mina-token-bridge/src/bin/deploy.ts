// Load environment variables from .env file
import 'dotenv/config';
// Other imports
import {
    Mina,
    PrivateKey,
    PublicKey,
    AccountUpdate,
    Bool,
    type NetworkId,
    UInt8,
} from 'o1js';
import { Logger, LogPrinter } from 'esm-iso-logger';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { rootDir } from '../utils.js';
import { NoriTokenBridge } from '../NoriTokenBridge.js';
import { NoriStorageInterface } from '../NoriStorageInterface.js';
import { FungibleToken } from '../TokenBase.js';
import {
    Bytes32,
    Bytes32FieldPair,
    compileAndVerifyContracts,
} from '@nori-zk/o1js-zk-utils';
import { noriTokenBridgeVkHash } from '../integrity/NoriTokenBridge.VkHash.js';
import { noriStorageInterfaceVkHash } from '../integrity/NoriStorageInterface.VkHash.js';
import { fungibleTokenVkHash } from '../integrity/FungibleToken.VkHash.js';

const logger = new Logger('Deploy');

new LogPrinter('NoriTokenBridge');

// Collect all inputs upfront
const possibleNetworkUrl = process.env.MINA_RPC_NETWORK_URL;
const possibleNetwork = process.env.NETWORK;
const possibleDeployerKeyBase58 = process.env.SENDER_PRIVATE_KEY;
const fee = Number(process.env.TX_FEE || 0.1) * 1e9;
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
if (process.env.TOKEN_BASE_PRIVATE_KEY)
    issues.push(
        'TOKEN_BASE_PRIVATE_KEY must not be set for initial deployment — this script generates a random key. Remove it.'
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

// Generate fresh keys for both contracts
const zkAppPrivateKey = PrivateKey.random();
const zkAppPrivateKeyBase58 = zkAppPrivateKey.toBase58();
const tokenBasePrivateKey = PrivateKey.random();
const tokenBasePrivateKeyBase58 = tokenBasePrivateKey.toBase58();

const tokenBaseAllowUpdates = true;

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

function writeSuccessDetailsToEnvFile(
    zkAppAddressBase58: string,
    tokenBaseAddressBase58: string,
    tokenBaseTokenId: string,
    noriTokenBridgeTokenId: string
) {
    const env = {
        ZKAPP_PRIVATE_KEY: zkAppPrivateKeyBase58,
        ZKAPP_ADDRESS: zkAppAddressBase58,
        TOKEN_BASE_PRIVATE_KEY: tokenBasePrivateKeyBase58,
        TOKEN_BASE_ADDRESS: tokenBaseAddressBase58,
        ADMIN_PUBLIC_KEY: adminPublicKey.toBase58(),
        TOKEN_BASE_TOKEN_ID: tokenBaseTokenId,
        NORI_TOKEN_BRIDGE_TOKEN_ID: noriTokenBridgeTokenId,
        UPDATE_TOKEN_BASE_VK: tokenBaseAllowUpdates.toString(), // ALWAYS TRUE
        UPDATE_NORI_TOKEN_BRIDGE_VK: 'false',
    };
    const envFileStr =
        Object.entries(env)
            .map(([key, value]) => `${key}=${value}`)
            .join('\n') + `\n`;
    const envFileOutputPath = resolve(rootDir, '..', '.env.nori-token-bridge');
    logger.info(`Writing env file with the details: '${envFileOutputPath}'`);
    writeFileSync(envFileOutputPath, envFileStr, 'utf8');
    logger.log(`Wrote '${envFileOutputPath}' successfully.`);
}

async function deploy() {
    const deployerAccount = deployerKey.toPublicKey();
    const zkAppAddress = zkAppPrivateKey.toPublicKey();
    const tokenBaseAddress = tokenBasePrivateKey.toPublicKey();
    logger.log(`Deployer address: '${deployerAccount.toBase58()}'.`);
    logger.log(`NoriTokenBridge address: '${zkAppAddress.toBase58()}'.`);
    logger.log(`FungibleToken address: '${tokenBaseAddress.toBase58()}'.`);

    const Network = Mina.Network({ networkId, mina: networkUrl });
    Mina.setActiveInstance(Network);

    // Compile and verify all three contracts
    const { NoriStorageInterfaceVerificationKey, NoriTokenBridgeVerificationKey } =
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

    const zkApp = new NoriTokenBridge(zkAppAddress);
    const fungibleToken = new FungibleToken(tokenBaseAddress);
    const initialStoreHash = Bytes32FieldPair.fromBytes32(storeHash);

    logger.log('Creating deployment transaction...');
    const txn = await Mina.transaction(
        { fee, sender: deployerAccount },
        async () => {
            AccountUpdate.fundNewAccount(deployerAccount, 3);
            logger.log(
                `Deploying NoriTokenBridge with verification key hash: '${NoriTokenBridgeVerificationKey.hash}'`
            );
            await zkApp.deploy({
                verificationKey: NoriTokenBridgeVerificationKey,
                adminPublicKey,
                tokenBaseAddress,
                storageVKHash: NoriStorageInterfaceVerificationKey.hash,
                newStoreHash: initialStoreHash,
            });
            logger.log('Deploying FungibleToken.');
            await fungibleToken.deploy({
                symbol: 'nETH',
                src: 'https://github.com/2nori/nori-bridge-sdk',
                allowUpdates: tokenBaseAllowUpdates,
            });
            await fungibleToken.initialize(
                zkAppAddress,
                UInt8.from(6),
                Bool(false)
            );
        }
    );

    logger.log('Proving transaction');
    await txn.prove();
    const signedTx = txn.sign([deployerKey, zkAppPrivateKey, tokenBasePrivateKey]);
    logger.log('Sending transaction...');
    const pendingTx = await signedTx.send();
    logger.log('Waiting for transaction to be included in a block...');
    await pendingTx.wait();

    const tokenBaseTokenId = fungibleToken.deriveTokenId().toString();
    const noriTokenBridgeTokenId = zkApp.deriveTokenId().toString();
    logger.log(`Token Base Token ID: ${tokenBaseTokenId}`);
    logger.log(`NoriTokenBridge Token ID: ${noriTokenBridgeTokenId}`);

    logger.log('Deployment successful!');
    writeSuccessDetailsToEnvFile(
        zkAppAddress.toBase58(),
        tokenBaseAddress.toBase58(),
        tokenBaseTokenId,
        noriTokenBridgeTokenId
    );
}

deploy().catch((err) => {
    logger.fatal(`Deploy function encountered an error.\n${String(err)}`);
    process.exit(1);
});
