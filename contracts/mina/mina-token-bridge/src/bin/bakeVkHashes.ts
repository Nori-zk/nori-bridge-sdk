import { Logger, LogPrinter } from 'esm-iso-logger';
import { resolve } from 'path';
import { Cache, type SmartContract } from 'o1js';
import { randomBytes } from 'crypto';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { NoriTokenBridge } from '../NoriTokenBridge.js';
import { NoriStorageInterface } from '../NoriStorageInterface.js';
import { FungibleToken } from '../TokenBase.js';
import { rootDir } from '../utils.js';

new LogPrinter('NoriTokenBridge');

const logger = new Logger('BakeVkHashes');

type ContractInfo = {
    name: string;
    contract: typeof SmartContract;
};

const contracts: ContractInfo[] = [
    { name: 'NoriStorageInterface', contract: NoriStorageInterface },
    { name: 'FungibleToken', contract: FungibleToken },
    { name: 'NoriTokenBridge', contract: NoriTokenBridge },
];

async function compileAll(cacheDir: string) {
    const vkHashes: Record<string, string> = {};
    const vkData: Record<string, string> = {};

    for (const { name, contract } of contracts) {
        logger.log(`Analyzing methods for ${name}.`);
        const analysis = await contract.analyzeMethods();

        for (const [methodName, data] of Object.entries(analysis)) {
            logger.log(`${name}.${methodName} gates length '${data.gates.length}'.`);
        }

        logger.log(`Compiling ${name}.`);
        const { verificationKey } = await contract.compile({
            cache: Cache.FileSystem(cacheDir),
            forceRecompile: true,
        });

        const vkHash = verificationKey.hash.toString();
        logger.log(`${name} compiled VK: '${vkHash}'.`);

        vkHashes[name] = vkHash;
        vkData[name] = verificationKey.data;
    }

    return { vkHashes, vkData };
}

function writeIntegrityFiles(vkHashes: Record<string, string>, vkData: Record<string, string>) {
    const integrityDir = resolve(rootDir, '..', 'src', 'integrity');
    logger.log(`Writing VK hashes to '${integrityDir}'`);

    for (const [name, hash] of Object.entries(vkHashes)) {
        const vkHashFilePath = resolve(integrityDir, `${name}.VkHash.json`);
        writeFileSync(vkHashFilePath, `"${hash}"`, 'utf8');
        logger.log(`Wrote ${name} VK hash to '${vkHashFilePath}'.`);
        const vkDataFilePath = resolve(integrityDir, `${name}.VkData.json`);
        writeFileSync(vkDataFilePath, `"${vkData[name]}"`, 'utf8');
        logger.log(`Wrote ${name} VK data to '${vkDataFilePath}'.`);
    }
}

const ephemeralCacheDir = resolve(
    rootDir,
    randomBytes(20).toString('base64').replace(/[+/=]/g, '')
);

async function main() {
    mkdirSync(ephemeralCacheDir, { recursive: true });
    logger.log(`Created ephemeral build cache '${ephemeralCacheDir}'`);

    try {
        const { vkHashes, vkData } = await compileAll(ephemeralCacheDir);
        writeIntegrityFiles(vkHashes, vkData);
    } finally {
        rmSync(ephemeralCacheDir, { recursive: true, force: true });
        logger.log(`Removed ephemeral cache '${ephemeralCacheDir}'`);
    }
}

main().catch((err) => {
    rmSync(ephemeralCacheDir, { recursive: true, force: true });
    logger.fatal(`Main function had an error:\n${String(err.stack)}`);
});
