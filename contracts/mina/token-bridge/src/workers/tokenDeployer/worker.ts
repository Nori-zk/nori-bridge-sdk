import {
    CacheType,
    compileAndOptionallyVerifyContracts,
    EthVerifier,
    ethVerifierVkHash,
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
import { NoriStorageInterface } from '../../NoriStorageInterface.js';
import { FungibleToken } from '../../TokenBase.js';
import { NoriTokenController } from '../../NoriTokenController.js';
import { noriTokenControllerVkHash } from '../../integrity/NoriTokenController.VkHash.js';
import { noriStorageInterfaceVkHash } from '../../integrity/NoriStorageInterface.VkHash.js';
import { fungibleTokenVkHash } from '../../integrity/FungibleToken.VkHash.js';
import { resolve } from 'path';
import { mkdirSync, rmSync } from 'fs';
import os from 'os';
import { Logger, LogPrinter } from 'esm-iso-logger';

new LogPrinter('TokenDeployerWorker');
const logger = new Logger('TokenDeployerWorker');

export interface DeploymentResult {
    noriTokenControllerAddress: string;
    tokenBaseAddress: string;
    tokenBaseTokenId: string;
    noriTokenControllerTokenId: string;
    txHash: string;
}

function getRandomCacheDir(prefix = 'mina-eth-processor-cache') {
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
    // Mina setup ******************************************************************************

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
        logger.log('Compiling all contracts/programs ...');

        const randomFileSystemCacheConfig = getRandomCacheDir();
        this.#cacheConfig = randomFileSystemCacheConfig;
        const fileSystemCache = await cacheFactory(randomFileSystemCacheConfig);

        const contracts = [
            {
                name: 'ethVerifier',
                program: EthVerifier,
                integrityHash: ethVerifierVkHash,
            },
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
                name: 'NoriTokenController',
                program: NoriTokenController,
                integrityHash: noriTokenControllerVkHash,
            },
        ] as const;

        // Compile all contracts using the helper
        const compiledVks = await compileAndOptionallyVerifyContracts(
            logger,
            contracts,
            fileSystemCache
        );

        // Manually assign each VK to a Safe key
        const ethVerifierVerificationKeySafe = vkToVkSafe(
            compiledVks.ethVerifierVerificationKey
        );
        const noriStorageInterfaceVerificationKeySafe = vkToVkSafe(
            compiledVks.NoriStorageInterfaceVerificationKey
        );
        const fungibleTokenVerificationKeySafe = vkToVkSafe(
            compiledVks.FungibleTokenVerificationKey
        );
        const noriTokenControllerVerificationKeySafe = vkToVkSafe(
            compiledVks.NoriTokenControllerVerificationKey
        );

        logger.log('All contracts/programs compiled successfully.');

        return {
            ethVerifierVerificationKeySafe,
            noriStorageInterfaceVerificationKeySafe,
            fungibleTokenVerificationKeySafe,
            noriTokenControllerVerificationKeySafe,
        };
    }

    async deployContracts(
        senderPrivateKeyBase58: string,
        adminPublicKeyBase58: string,
        tokenControllerPrivateKeyBase58: string,
        tokenBasePrivateKeyBase58: string,
        ethProcessorAddressBase58: string,
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
        const storageInterfaceVerificationKeyHashBigInt = BigInt(
            storageInterfaceVerificationKeyHashStr
        );
        const hash = new Field(storageInterfaceVerificationKeyHashBigInt);
        const storageInterfaceVerificationKey = { data, hash };
        const adminPublicKey = PublicKey.fromBase58(adminPublicKeyBase58);
        logger.log('senderPrivateKeyBase58', !!senderPrivateKeyBase58);
        const senderPrivateKey = PrivateKey.fromBase58(senderPrivateKeyBase58);

        const ethProcessorAddress = PublicKey.fromBase58(
            ethProcessorAddressBase58
        );

        logger.log('Deploying NoriTokenController and TokenBase contracts...');

        const symbol = options.symbol || 'nETH';
        const decimals = UInt8.from(options.decimals || 18);
        const allowUpdates = options.allowUpdates ?? true;
        const startPaused = Bool(options.startPaused ?? false);

        const senderPublicKey = senderPrivateKey.toPublicKey();

        const noriTokenControllerPrivateKey = PrivateKey.fromBase58(
            tokenControllerPrivateKeyBase58
        );
        const noriTokenControllerPublicKey =
            noriTokenControllerPrivateKey.toPublicKey();

        const tokenBasePrivateKey = PrivateKey.fromBase58(
            tokenBasePrivateKeyBase58
        );
        const tokenBaseAddress = tokenBasePrivateKey.toPublicKey();

        const noriTokenController = new NoriTokenController(
            noriTokenControllerPublicKey
        );
        const tokenBase = new FungibleToken(tokenBaseAddress);

        const deployTx = await Mina.transaction(
            { sender: senderPublicKey, fee: txFee },
            async () => {
                AccountUpdate.fundNewAccount(senderPublicKey, 3);

                // Deploy NoriTokenController
                await noriTokenController.deploy({
                    adminPublicKey: adminPublicKey,
                    tokenBaseAddress: tokenBaseAddress,
                    storageVKHash: storageInterfaceVerificationKey.hash,
                    ethProcessorAddress,
                });

                // Deploy TokenBase
                await tokenBase.deploy({
                    symbol,
                    src: 'https://x.com/nori_zk',
                    allowUpdates,
                });

                // Initialize TokenBase
                await tokenBase.initialize(
                    noriTokenControllerPublicKey,
                    decimals,
                    startPaused
                );
            }
        );

        logger.log('Deploy transaction created. Proving...');
        await deployTx.prove();

        logger.log('Transaction proved. Signing and sending...');
        const tx = await deployTx
            .sign([
                senderPrivateKey,
                noriTokenControllerPrivateKey,
                tokenBasePrivateKey,
            ])
            .send();

        const result = await tx.wait();

        logger.log('Contracts deployed successfully');

        // Derive token IDs
        const tokenBaseTokenId = tokenBase.deriveTokenId().toString();
        const noriTokenControllerTokenId = noriTokenController.deriveTokenId().toString();
        logger.log(`Token Base Token ID: ${tokenBaseTokenId}`);
        logger.log(`NoriTokenController Token ID: ${noriTokenControllerTokenId}`);

        removeCacheDir(this.#cacheConfig);

        return {
            noriTokenControllerAddress: noriTokenController.address.toBase58(),
            tokenBaseAddress: tokenBase.address.toBase58(),
            tokenBaseTokenId,
            noriTokenControllerTokenId,
            txHash: result.hash,
        };
    }

    async updateVerificationKeys(
        senderPrivateKeyBase58: string,
        noriTokenControllerAddressBase58: string,
        tokenBaseAddressBase58: string,
        noriTokenControllerVerificationKeySafe: VerificationKeySafe,
        fungibleTokenVerificationKeySafe: VerificationKeySafe,
        txFee: number
    ): Promise<DeploymentResult> {
        logger.log('Updating verification keys for NoriTokenController and TokenBase...');

        const senderPrivateKey = PrivateKey.fromBase58(senderPrivateKeyBase58);
        const senderPublicKey = senderPrivateKey.toPublicKey();

        const noriTokenControllerAddress = PublicKey.fromBase58(noriTokenControllerAddressBase58);
        const tokenBaseAddress = PublicKey.fromBase58(tokenBaseAddressBase58);

        // Reconstruct VerificationKey objects from safe format
        const noriTokenControllerVk = {
            data: noriTokenControllerVerificationKeySafe.data,
            hash: new Field(BigInt(noriTokenControllerVerificationKeySafe.hashStr)),
        };
        const fungibleTokenVk = {
            data: fungibleTokenVerificationKeySafe.data,
            hash: new Field(BigInt(fungibleTokenVerificationKeySafe.hashStr)),
        };

        const noriTokenController = new NoriTokenController(noriTokenControllerAddress);
        const tokenBase = new FungibleToken(tokenBaseAddress);

        const updateTx = await Mina.transaction(
            { sender: senderPublicKey, fee: txFee },
            async () => {
                logger.log(`Updating NoriTokenController VK hash: '${noriTokenControllerVk.hash}'`);
                await noriTokenController.updateVerificationKey(noriTokenControllerVk);

                logger.log(`Updating TokenBase VK hash: '${fungibleTokenVk.hash}'`);
                await tokenBase.updateVerificationKey(fungibleTokenVk);
            }
        );

        logger.log('Update transaction created. Proving...');
        await updateTx.prove();

        logger.log('Transaction proved. Signing and sending...');
        const tx = await updateTx.sign([senderPrivateKey]).send();

        const result = await tx.wait();

        logger.log('Verification keys updated successfully');

        // Derive token IDs
        const tokenBaseTokenId = tokenBase.deriveTokenId().toString();
        const noriTokenControllerTokenId = noriTokenController.deriveTokenId().toString();
        logger.log(`Token Base Token ID: ${tokenBaseTokenId}`);
        logger.log(`NoriTokenController Token ID: ${noriTokenControllerTokenId}`);

        removeCacheDir(this.#cacheConfig);

        return {
            noriTokenControllerAddress: noriTokenController.address.toBase58(),
            tokenBaseAddress: tokenBase.address.toBase58(),
            tokenBaseTokenId,
            noriTokenControllerTokenId,
            txHash: result.hash,
        };
    }
}
