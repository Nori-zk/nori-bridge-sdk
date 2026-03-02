import {
    Bytes32,
    Bytes32FieldPair,
    CacheType,
    compileAndOptionallyVerifyContracts,
    type FileSystemCacheConfig,
    type VerificationKeySafe,
    vkToVkSafe,
} from '@nori-zk/o1js-zk-utils';
import { cacheFactory } from '@nori-zk/o1js-zk-utils/node';
import {
    AccountUpdate,
    Bool,
    Field,
    Mina,
    type NetworkId,
    PrivateKey,
    PublicKey,
    UInt8,
} from 'o1js';
import { NoriTokenBridge } from '../../NoriTokenBridge.js';
import { NoriStorageInterface } from '../../NoriStorageInterface.js';
import { FungibleToken } from '../../TokenBase.js';
import { noriTokenBridgeVkHash } from '../../integrity/NoriTokenBridge.VkHash.js';
import { noriStorageInterfaceVkHash } from '../../integrity/NoriStorageInterface.VkHash.js';
import { fungibleTokenVkHash } from '../../integrity/FungibleToken.VkHash.js';
import { resolve } from 'path';
import { mkdirSync, rmSync } from 'fs';
import os from 'os';
import { Logger, LogPrinter } from 'esm-iso-logger';

new LogPrinter('NoriTokenBridgeDeployerWorker');
const logger = new Logger('NoriTokenBridgeDeployerWorker');

export interface DeploymentResult {
    noriTokenBridgeAddress: string;
    tokenBaseAddress: string;
    tokenBaseTokenId: string;
    noriTokenBridgeTokenId: string;
    txHash: string;
}

function getRandomCacheDir(prefix = 'mina-token-bridge-cache') {
    const randomSuffix = `${Date.now()}-${Math.floor(
        Math.random() * 1_000_000
    )}`;
    const cacheDir = resolve(os.tmpdir(), `${prefix}-${randomSuffix}`);
    mkdirSync(cacheDir, { recursive: true });
    const cacheConfig: FileSystemCacheConfig = {
        type: CacheType.FileSystem,
        dir: cacheDir,
    };
    return cacheConfig;
}

function removeCacheDir(cacheConfig: FileSystemCacheConfig) {
    rmSync(cacheConfig.dir, { recursive: true, force: true });
}

export class TokenDeployerWorker {
    #cacheConfig: FileSystemCacheConfig | undefined;

    async minaSetup(options: {
        networkId?: NetworkId;
        mina: string | string[];
        archive?: string | string[];
        lightnetAccountManager?: string;
        bypassTransactionLimits?: boolean;
        minaDefaultHeaders?: HeadersInit;
        archiveDefaultHeaders?: HeadersInit;
    }) {
        const Network = Mina.Network(options);
        Mina.setActiveInstance(Network);
    }

    async compile() {
        logger.log('Compiling all contracts...');

        const randomFileSystemCacheConfig = getRandomCacheDir();
        this.#cacheConfig = randomFileSystemCacheConfig;
        const fileSystemCache = await cacheFactory(randomFileSystemCacheConfig);

        const contracts = [
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
        ] as const;

        const compiledVks = await compileAndOptionallyVerifyContracts(
            logger,
            contracts,
            fileSystemCache
        );

        const noriStorageInterfaceVerificationKeySafe = vkToVkSafe(
            compiledVks.NoriStorageInterfaceVerificationKey
        );
        const fungibleTokenVerificationKeySafe = vkToVkSafe(
            compiledVks.FungibleTokenVerificationKey
        );
        const noriTokenBridgeVerificationKeySafe = vkToVkSafe(
            compiledVks.NoriTokenBridgeVerificationKey
        );

        logger.log('All contracts compiled successfully.');

        return {
            noriStorageInterfaceVerificationKeySafe,
            fungibleTokenVerificationKeySafe,
            noriTokenBridgeVerificationKeySafe,
        };
    }

    async deployContracts(
        senderPrivateKeyBase58: string,
        adminPublicKeyBase58: string,
        noriTokenBridgePrivateKeyBase58: string,
        tokenBasePrivateKeyBase58: string,
        storeHashHex: string,
        storageInterfaceVerificationKeySafe: {
            data: string;
            hashStr: string;
        },
        txFee: number,
        options: {
            symbol?: string;
            decimals?: number;
            allowUpdates?: boolean;
            startPaused?: boolean;
        } = {}
    ): Promise<DeploymentResult> {
        const { hashStr: storageInterfaceVerificationKeyHashStr, data } =
            storageInterfaceVerificationKeySafe;
        const hash = new Field(BigInt(storageInterfaceVerificationKeyHashStr));
        const storageInterfaceVerificationKey = { data, hash };

        const adminPublicKey = PublicKey.fromBase58(adminPublicKeyBase58);
        const senderPrivateKey = PrivateKey.fromBase58(senderPrivateKeyBase58);
        const senderPublicKey = senderPrivateKey.toPublicKey();

        const noriTokenBridgePrivateKey = PrivateKey.fromBase58(
            noriTokenBridgePrivateKeyBase58
        );
        const noriTokenBridgePublicKey = noriTokenBridgePrivateKey.toPublicKey();

        const tokenBasePrivateKey = PrivateKey.fromBase58(
            tokenBasePrivateKeyBase58
        );
        const tokenBaseAddress = tokenBasePrivateKey.toPublicKey();

        const newStoreHash = Bytes32FieldPair.fromBytes32(
            Bytes32.fromHex(storeHashHex)
        );

        const symbol = options.symbol || 'nETH';
        const decimals = UInt8.from(options.decimals || 6);
        const allowUpdates = options.allowUpdates ?? true;
        const startPaused = Bool(options.startPaused ?? false);

        logger.log('Deploying NoriTokenBridge and FungibleToken contracts...');

        const noriTokenBridge = new NoriTokenBridge(noriTokenBridgePublicKey);
        const tokenBase = new FungibleToken(tokenBaseAddress);

        const deployTx = await Mina.transaction(
            { sender: senderPublicKey, fee: txFee },
            async () => {
                AccountUpdate.fundNewAccount(senderPublicKey, 3);

                await noriTokenBridge.deploy({
                    adminPublicKey,
                    tokenBaseAddress,
                    storageVKHash: storageInterfaceVerificationKey.hash,
                    newStoreHash,
                });

                await tokenBase.deploy({
                    symbol,
                    src: 'https://github.com/2nori/nori-bridge-sdk',
                    allowUpdates,
                });

                await tokenBase.initialize(
                    noriTokenBridgePublicKey,
                    decimals,
                    startPaused
                );
            }
        );

        logger.log('Deploy transaction created. Proving...');
        await deployTx.prove();

        logger.log('Transaction proved. Signing and sending...');
        const tx = await deployTx
            .sign([senderPrivateKey, noriTokenBridgePrivateKey, tokenBasePrivateKey])
            .send();

        const result = await tx.wait();

        logger.log('Contracts deployed successfully.');

        const tokenBaseTokenId = tokenBase.deriveTokenId().toString();
        const noriTokenBridgeTokenId = noriTokenBridge.deriveTokenId().toString();
        logger.log(`Token Base Token ID: ${tokenBaseTokenId}`);
        logger.log(`NoriTokenBridge Token ID: ${noriTokenBridgeTokenId}`);

        removeCacheDir(this.#cacheConfig);

        return {
            noriTokenBridgeAddress: noriTokenBridge.address.toBase58(),
            tokenBaseAddress: tokenBase.address.toBase58(),
            tokenBaseTokenId,
            noriTokenBridgeTokenId,
            txHash: result.hash,
        };
    }

    async updateVerificationKeys(
        senderPrivateKeyBase58: string,
        noriTokenBridgeAddressBase58: string,
        tokenBaseAddressBase58: string,
        noriTokenBridgeVerificationKeySafe: VerificationKeySafe,
        fungibleTokenVerificationKeySafe: VerificationKeySafe,
        txFee: number,
        updateTokenBaseVK: boolean,
        updateNoriTokenBridgeVK: boolean
    ): Promise<DeploymentResult> {
        const updates: string[] = [];
        if (updateTokenBaseVK) updates.push('FungibleToken');
        if (updateNoriTokenBridgeVK) updates.push('NoriTokenBridge');
        logger.log(`Updating verification keys for: ${updates.join(', ')}`);

        const senderPrivateKey = PrivateKey.fromBase58(senderPrivateKeyBase58);
        const senderPublicKey = senderPrivateKey.toPublicKey();

        const noriTokenBridgeAddress = PublicKey.fromBase58(noriTokenBridgeAddressBase58);
        const tokenBaseAddress = PublicKey.fromBase58(tokenBaseAddressBase58);

        const noriTokenBridgeVk = {
            data: noriTokenBridgeVerificationKeySafe.data,
            hash: new Field(BigInt(noriTokenBridgeVerificationKeySafe.hashStr)),
        };
        const fungibleTokenVk = {
            data: fungibleTokenVerificationKeySafe.data,
            hash: new Field(BigInt(fungibleTokenVerificationKeySafe.hashStr)),
        };

        const noriTokenBridge = new NoriTokenBridge(noriTokenBridgeAddress);
        const tokenBase = new FungibleToken(tokenBaseAddress);

        const updateTx = await Mina.transaction(
            { sender: senderPublicKey, fee: txFee },
            async () => {
                if (updateNoriTokenBridgeVK) {
                    logger.log(`Updating NoriTokenBridge VK hash: '${noriTokenBridgeVk.hash}'`);
                    await noriTokenBridge.updateVerificationKey(noriTokenBridgeVk);
                }

                if (updateTokenBaseVK) {
                    logger.log(`Updating FungibleToken VK hash: '${fungibleTokenVk.hash}'`);
                    await tokenBase.updateVerificationKey(fungibleTokenVk);
                }
            }
        );

        logger.log('Update transaction created. Proving...');
        await updateTx.prove();

        logger.log('Transaction proved. Signing and sending...');
        const tx = await updateTx.sign([senderPrivateKey]).send();
        const result = await tx.wait();

        logger.log('Verification keys updated successfully.');

        const tokenBaseTokenId = tokenBase.deriveTokenId().toString();
        const noriTokenBridgeTokenId = noriTokenBridge.deriveTokenId().toString();
        logger.log(`Token Base Token ID: ${tokenBaseTokenId}`);
        logger.log(`NoriTokenBridge Token ID: ${noriTokenBridgeTokenId}`);

        removeCacheDir(this.#cacheConfig);

        return {
            noriTokenBridgeAddress: noriTokenBridge.address.toBase58(),
            tokenBaseAddress: tokenBase.address.toBase58(),
            tokenBaseTokenId,
            noriTokenBridgeTokenId,
            txHash: result.hash,
        };
    }
}
