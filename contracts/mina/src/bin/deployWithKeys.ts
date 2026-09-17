// Load environment variables from .env file
import 'dotenv/config';
// Other imports
import {
    Mina,
    PrivateKey,
    PublicKey,
    AccountUpdate,
    Bool,
    Field,
    type NetworkId,
    Poseidon,
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
    Bytes20,
    Bytes32,
    Bytes32FieldPair,
    bridgeHeadNoriSP1HeliosProgramPi0,
    compileAndVerifyContracts,
    proofConversionSP1ToPlonkPO2,
} from '@nori-zk/o1js-zk-utils';
import { FrC } from '@nori-zk/proof-conversion/min';
import { noriTokenBridgeVkHash } from '../integrity/NoriTokenBridge.VkHash.js';
import { noriStorageInterfaceVkHash } from '../integrity/NoriStorageInterface.VkHash.js';
import { fungibleTokenVkHash } from '../integrity/FungibleToken.VkHash.js';

const logger = new Logger('DeployWithKeys');

new LogPrinter('NoriTokenBridge');

// Variant of `deploy.ts` that takes every input from environment variables
// (no positional args). The Bridge / Base private keys, the deploy parameters
// (initial store hash, Ethereum bridge address, genesis root) and the optional
// admin public key are all read from env, matching the names produced by
// `npm run pre-deploy` and the Ethereum-side deploy task — so the typical
// flow is to source the upstream `.env.*` files and run this script.
// Transaction body and env-file output are identical to `deploy.ts`.

const stripHex0x = (val: string): string =>
    val.startsWith('0x') || val.startsWith('0X') ? val.slice(2) : val;

// Collect all inputs upfront
const possibleNetworkUrl = process.env.MINA_RPC_NETWORK_URL;
const possibleNetwork = process.env.MINA_NETWORK;
const possibleDeployerKeyBase58 = process.env.MINA_SENDER_PRIVATE_KEY;
const possibleTokenBridgePrivateKeyBase58 = process.env.NORI_MINA_TOKEN_BRIDGE_PRIVATE_KEY;
const possibleTokenBasePrivateKeyBase58 = process.env.NORI_MINA_TOKEN_BASE_PRIVATE_KEY;
const fee = Number(process.env.MINA_TX_FEE || 0.1) * 1e9;
const possibleStoreHashHexRaw = process.env.NORI_INITIAL_STORE_HASH;
const possibleEthTokenBridgeAddressHexRaw = process.env.NORI_ETH_TOKEN_BRIDGE_ADDRESS;
const possibleEthProofQueueAddressHexRaw = process.env.NORI_ETH_PROOF_QUEUE_ADDRESS;
const possibleAdminPublicKeyBase58 = process.env.NORI_MINA_TOKEN_BRIDGE_ADMIN;

const possibleStoreHashHex = possibleStoreHashHexRaw
    ? stripHex0x(possibleStoreHashHexRaw)
    : undefined;
const possibleEthTokenBridgeAddressHex = possibleEthTokenBridgeAddressHexRaw
    ? stripHex0x(possibleEthTokenBridgeAddressHexRaw)
    : undefined;
const possibleEthProofQueueAddressHex = possibleEthProofQueueAddressHexRaw
    ? stripHex0x(possibleEthProofQueueAddressHexRaw)
    : undefined;

// Validate everything in one pass
const issues: string[] = [];

if (!possibleNetworkUrl)
    issues.push('Missing required env: MINA_RPC_NETWORK_URL');
if (!possibleNetwork) issues.push('Missing required env: MINA_NETWORK');
if (!possibleDeployerKeyBase58)
    issues.push('Missing required env: MINA_SENDER_PRIVATE_KEY (must be the contract deployer private key)');
if (!possibleTokenBridgePrivateKeyBase58)
    issues.push('Missing required env: NORI_MINA_TOKEN_BRIDGE_PRIVATE_KEY (Base58 private key for the Bridge zkApp account)');
if (!possibleTokenBasePrivateKeyBase58)
    issues.push('Missing required env: NORI_MINA_TOKEN_BASE_PRIVATE_KEY (Base58 private key for the Base zkApp account)');
if (!possibleStoreHashHexRaw)
    issues.push('Missing required env: NORI_INITIAL_STORE_HASH (32-byte hex; DEPLOYMENT.md §5)');
if (!possibleEthTokenBridgeAddressHexRaw)
    issues.push('Missing required env: NORI_ETH_TOKEN_BRIDGE_ADDRESS (Ethereum bridge address; written by ethereum `npm run deploy`)');
if (!possibleEthProofQueueAddressHexRaw)
    issues.push('Missing required env: NORI_ETH_PROOF_QUEUE_ADDRESS (Ethereum proof request queue address; written by ethereum `npm run deploy`)');

let possibleDeployerKey: PrivateKey | undefined;
if (possibleDeployerKeyBase58) {
    try {
        possibleDeployerKey = PrivateKey.fromBase58(possibleDeployerKeyBase58);
    } catch (e) {
        issues.push(
            `MINA_SENDER_PRIVATE_KEY (contract deployer) is not a valid private key: ${(e as Error).message}`
        );
    }
}

let possibleTokenBridgePrivateKey: PrivateKey | undefined;
if (possibleTokenBridgePrivateKeyBase58) {
    try {
        possibleTokenBridgePrivateKey = PrivateKey.fromBase58(possibleTokenBridgePrivateKeyBase58);
    } catch (e) {
        issues.push(
            `NORI_MINA_TOKEN_BRIDGE_PRIVATE_KEY is not a valid private key: ${(e as Error).message}`
        );
    }
}

let possibleTokenBasePrivateKey: PrivateKey | undefined;
if (possibleTokenBasePrivateKeyBase58) {
    try {
        possibleTokenBasePrivateKey = PrivateKey.fromBase58(possibleTokenBasePrivateKeyBase58);
    } catch (e) {
        issues.push(
            `NORI_MINA_TOKEN_BASE_PRIVATE_KEY is not a valid private key: ${(e as Error).message}`
        );
    }
}

let possibleStoreHash: Bytes32 | undefined;
if (possibleStoreHashHex) {
    if (possibleStoreHashHex.length !== 64) {
        issues.push(
            `NORI_INITIAL_STORE_HASH '${possibleStoreHashHexRaw}' must be exactly 64 hex characters (32 bytes), got ${possibleStoreHashHex.length}`
        );
    } else {
        try {
            possibleStoreHash = Bytes32.fromHex(possibleStoreHashHex);
        } catch (e) {
            issues.push(
                `NORI_INITIAL_STORE_HASH '${possibleStoreHashHexRaw}' is not a valid 32-byte hex string: ${(e as Error).message}`
            );
        }
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
            `NORI_MINA_TOKEN_BRIDGE_ADMIN '${possibleAdminPublicKeyBase58}' is not a valid public key: ${(e as Error).message}`
        );
    }
}

let possibleEthTokenBridgeAddress: Field | undefined;
if (possibleEthTokenBridgeAddressHex) {
    if (possibleEthTokenBridgeAddressHex.length !== 40) {
        issues.push(
            `NORI_ETH_TOKEN_BRIDGE_ADDRESS '${possibleEthTokenBridgeAddressHexRaw}' must be exactly 40 hex characters (20 bytes), got ${possibleEthTokenBridgeAddressHex.length}`
        );
    } else {
        try {
            possibleEthTokenBridgeAddress = Bytes20.fromHex(possibleEthTokenBridgeAddressHex).toField();
        } catch (e) {
            issues.push(
                `NORI_ETH_TOKEN_BRIDGE_ADDRESS '${possibleEthTokenBridgeAddressHexRaw}' is not a valid 20-byte hex string: ${(e as Error).message}`
            );
        }
    }
}

let possibleEthProofQueueAddress: Field | undefined;
if (possibleEthProofQueueAddressHex) {
    if (possibleEthProofQueueAddressHex.length !== 40) {
        issues.push(
            `NORI_ETH_PROOF_QUEUE_ADDRESS '${possibleEthProofQueueAddressHexRaw}' must be exactly 40 hex characters (20 bytes), got ${possibleEthProofQueueAddressHex.length}`
        );
    } else {
        try {
            possibleEthProofQueueAddress = Bytes20.fromHex(possibleEthProofQueueAddressHex).toField();
        } catch (e) {
            issues.push(
                `NORI_ETH_PROOF_QUEUE_ADDRESS '${possibleEthProofQueueAddressHexRaw}' is not a valid 20-byte hex string: ${(e as Error).message}`
            );
        }
    }
}

if (issues.length) {
    const formatted = [
        'DeployWithKeys encountered issues:',
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
function isField(val: Field | undefined): val is Field {
    return val !== undefined;
}
function isString(val: string | undefined): val is string {
    return val !== undefined;
}

if (
    !isPrivateKey(possibleDeployerKey) ||
    !isPrivateKey(possibleTokenBridgePrivateKey) ||
    !isPrivateKey(possibleTokenBasePrivateKey) ||
    !isBytes32(possibleStoreHash) ||
    !isField(possibleEthTokenBridgeAddress) ||
    !isField(possibleEthProofQueueAddress) ||
    !isString(possibleNetworkUrl) ||
    !isString(possibleNetwork)
) {
    logger.fatal('Internal error: required values undefined after validation.');
    process.exit(1);
}

const deployerKey = possibleDeployerKey;
const tokenBridgePrivateKey = possibleTokenBridgePrivateKey;
const tokenBridgePrivateKeyBase58 = tokenBridgePrivateKey.toBase58();
const tokenBasePrivateKey = possibleTokenBasePrivateKey;
const tokenBasePrivateKeyBase58 = tokenBasePrivateKey.toBase58();
const storeHash = possibleStoreHash;
const ethTokenBridgeAddress = possibleEthTokenBridgeAddress;
const ethProofQueueAddress = possibleEthProofQueueAddress;
const networkUrl = possibleNetworkUrl;
const networkId: NetworkId =
    possibleNetwork === 'mainnet' ? 'mainnet' : 'testnet';

const tokenBaseAllowUpdates = true;

let adminPublicKey: PublicKey;
if (isPublicKey(possibleAdminPublicKey)) {
    logger.log(
        `NORI_MINA_TOKEN_BRIDGE_ADMIN provided: '${possibleAdminPublicKeyBase58}'`
    );
    adminPublicKey = possibleAdminPublicKey;
} else {
    logger.warn(
        'No NORI_MINA_TOKEN_BRIDGE_ADMIN provided. Defaulting to the public key derived from MINA_SENDER_PRIVATE_KEY.'
    );
    adminPublicKey = deployerKey.toPublicKey();
}

logger.log(`NORI_INITIAL_STORE_HASH provided: '${possibleStoreHashHexRaw}'`);
logger.log(`NORI_ETH_TOKEN_BRIDGE_ADDRESS provided: '${possibleEthTokenBridgeAddressHexRaw}'`);
logger.log(`NORI_ETH_PROOF_QUEUE_ADDRESS provided: '${possibleEthProofQueueAddressHexRaw}'`);
logger.log(`Bridge address (from NORI_MINA_TOKEN_BRIDGE_PRIVATE_KEY): '${tokenBridgePrivateKey.toPublicKey().toBase58()}'`);
logger.log(`Base address (from NORI_MINA_TOKEN_BASE_PRIVATE_KEY):     '${tokenBasePrivateKey.toPublicKey().toBase58()}'`);

function writeSuccessDetailsToEnvFile(
    tokenBridgeAddressBase58: string,
    tokenBaseAddressBase58: string,
    tokenBaseTokenId: string,
    tokenBridgeTokenId: string
) {
    const env = {
        NORI_MINA_TOKEN_BRIDGE_PRIVATE_KEY: tokenBridgePrivateKeyBase58,
        NORI_MINA_TOKEN_BRIDGE_ADDRESS: tokenBridgeAddressBase58,
        NORI_MINA_TOKEN_BASE_PRIVATE_KEY: tokenBasePrivateKeyBase58,
        NORI_MINA_TOKEN_BASE_ADDRESS: tokenBaseAddressBase58,
        NORI_MINA_TOKEN_BRIDGE_ADMIN: adminPublicKey.toBase58(),
        NORI_MINA_TOKEN_BASE_TOKEN_ID: tokenBaseTokenId,
        NORI_MINA_TOKEN_BRIDGE_TOKEN_ID: tokenBridgeTokenId,
        NORI_MINA_TOKEN_BASE_ALLOW_VK_UPDATE: tokenBaseAllowUpdates.toString(), // ALWAYS TRUE
        NORI_MINA_TOKEN_BRIDGE_ALLOW_VK_UPDATE: 'false',
    };
    const envFileStr =
        Object.entries(env)
            .map(([key, value]) => `${key}=${value}`)
            .join('\n') + `\n`;
    const envFileOutputPath = resolve(rootDir, '..', '.env.nori-mina-token-bridge');
    logger.info(`Writing env file with the details: '${envFileOutputPath}'`);
    writeFileSync(envFileOutputPath, envFileStr, 'utf8');
    logger.log(`Wrote '${envFileOutputPath}' successfully.`);
}

async function deploy() {
    const deployerAccount = deployerKey.toPublicKey();
    const tokenBridgeAddress = tokenBridgePrivateKey.toPublicKey();
    const tokenBaseAddress = tokenBasePrivateKey.toPublicKey();
    logger.log(`Deployer address: '${deployerAccount.toBase58()}'.`);
    logger.log(`NoriTokenBridge address: '${tokenBridgeAddress.toBase58()}'.`);
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

    const tokenBridge = new NoriTokenBridge(tokenBridgeAddress);
    const tokenBase = new FungibleToken(tokenBaseAddress);
    const initialStoreHash = Bytes32FieldPair.fromBytes32(storeHash);

    logger.log('Creating deployment transaction...');
    const txn = await Mina.transaction(
        { fee, sender: deployerAccount },
        async () => {
            AccountUpdate.fundNewAccount(deployerAccount, 3);
            logger.log(
                `Deploying NoriTokenBridge with verification key hash: '${NoriTokenBridgeVerificationKey.hash}'`
            );
            await tokenBridge.deploy({
                verificationKey: NoriTokenBridgeVerificationKey,
                adminPublicKey,
                tokenBaseAddress,
                storageVKHash: NoriStorageInterfaceVerificationKey.hash,
                newStoreHash: initialStoreHash,
                ethTokenBridgeAddress,
                ethProofQueueAddress,
                noriHeliosProgramPi0: FrC.from(
                    bridgeHeadNoriSP1HeliosProgramPi0
                ),
                proofConversionPO2: Field.from(proofConversionSP1ToPlonkPO2),
            });
            logger.log('Deploying FungibleToken.');
            await tokenBase.deploy({
                symbol: 'nETH',
                src: 'https://github.com/Nori-zk/nori-bridge-sdk',
                allowUpdates: tokenBaseAllowUpdates,
            });
            await tokenBase.initialize(
                tokenBridgeAddress,
                UInt8.from(6),
                Bool(false)
            );
        }
    );

    logger.log('Proving transaction');
    await txn.prove();
    const signedTx = txn.sign([deployerKey, tokenBridgePrivateKey, tokenBasePrivateKey]);
    logger.log('Sending transaction...');
    const pendingTx = await signedTx.send();
    logger.log('Waiting for transaction to be included in a block...');
    await pendingTx.wait();

    const tokenBaseTokenId = tokenBase.deriveTokenId().toString();
    const tokenBridgeTokenId = tokenBridge.deriveTokenId().toString();
    logger.log(`Token Base Token ID: ${tokenBaseTokenId}`);
    logger.log(`NoriTokenBridge Token ID: ${tokenBridgeTokenId}`);

    logger.log('Deployment successful!');
    writeSuccessDetailsToEnvFile(
        tokenBridgeAddress.toBase58(),
        tokenBaseAddress.toBase58(),
        tokenBaseTokenId,
        tokenBridgeTokenId
    );
}

deploy().catch((err) => {
    logger.fatal(`DeployWithKeys function encountered an error.\n${String(err)}`);
    process.exit(1);
});
