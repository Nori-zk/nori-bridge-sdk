import { Logger, LogPrinter } from 'esm-iso-logger';
import { resolve } from 'path';
import { Cache } from 'o1js';
import { randomBytes } from 'crypto';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { NoriTokenBridge } from '../NoriTokenBridge.js';
import { NoriStorageInterface } from '../NoriStorageInterface.js';
import { FungibleToken } from '../TokenBase.js';
import { rootDir } from '../utils.js';

new LogPrinter('NoriTokenBridge');

const logger = new Logger('BakeVkHashes');

function writeSuccessDetailsToJsonFiles(
    noriStorageInterfaceVkHash: string,
    fungibleTokenVkHash: string,
    noriTokenBridgeVkHash: string,
    noriTokenBridgeVkData: string
) {
    const integrityDir = resolve(rootDir, '..', 'src', 'integrity');

    // NoriStorageInterface — hash only
    const storageHashPath = resolve(integrityDir, 'NoriStorageInterface.VkHash.json');
    writeFileSync(storageHashPath, `"${noriStorageInterfaceVkHash}"`, 'utf8');
    logger.log(`Wrote vk hash to '${storageHashPath}'.`);

    // FungibleToken — hash only
    const fungibleHashPath = resolve(integrityDir, 'FungibleToken.VkHash.json');
    writeFileSync(fungibleHashPath, `"${fungibleTokenVkHash}"`, 'utf8');
    logger.log(`Wrote vk hash to '${fungibleHashPath}'.`);

    // NoriTokenBridge — hash + data
    const bridgeHashPath = resolve(integrityDir, 'NoriTokenBridge.VkHash.json');
    writeFileSync(bridgeHashPath, `"${noriTokenBridgeVkHash}"`, 'utf8');
    logger.log(`Wrote vk hash to '${bridgeHashPath}'.`);

    const bridgeDataPath = resolve(integrityDir, 'NoriTokenBridge.VkData.json');
    writeFileSync(bridgeDataPath, `"${noriTokenBridgeVkData}"`, 'utf8');
    logger.log(`Wrote vk data to '${bridgeDataPath}'.`);
}

const ephemeralCacheDir = resolve(
    rootDir,
    randomBytes(20).toString('base64').replace(/[+/=]/g, '')
);

async function main() {
    mkdirSync(ephemeralCacheDir, { recursive: true });
    logger.log(`Created ephemeral cache directory '${ephemeralCacheDir}'.`);

    const cache = Cache.FileSystem(ephemeralCacheDir);

    logger.log('Compiling NoriStorageInterface...');
    const { verificationKey: storageVK } = await NoriStorageInterface.compile({
        cache,
        forceRecompile: true,
    });
    logger.log(`NoriStorageInterface VK hash: '${storageVK.hash}'.`);

    logger.log('Compiling FungibleToken...');
    const { verificationKey: fungibleVK } = await FungibleToken.compile({
        cache,
        forceRecompile: true,
    });
    logger.log(`FungibleToken VK hash: '${fungibleVK.hash}'.`);

    logger.log('Compiling NoriTokenBridge...');
    const { verificationKey: bridgeVK } = await NoriTokenBridge.compile({
        cache,
        forceRecompile: true,
    });
    logger.log(`NoriTokenBridge VK hash: '${bridgeVK.hash}'.`);

    rmSync(ephemeralCacheDir, { recursive: true });

    writeSuccessDetailsToJsonFiles(
        storageVK.hash.toString(),
        fungibleVK.hash.toString(),
        bridgeVK.hash.toString(),
        bridgeVK.data
    );

    logger.log('All VK hashes baked successfully.');
}

main().catch((err) => {
    logger.fatal(`bakeVkHashes failed:\n${String(err.stack)}`);
    rmSync(ephemeralCacheDir, { recursive: true });
    process.exit(1);
});
