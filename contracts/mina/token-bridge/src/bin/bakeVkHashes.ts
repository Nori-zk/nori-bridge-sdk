import { Logger, LogPrinter } from 'esm-iso-logger';
import { resolve } from 'path';
import { Cache, type SmartContract } from 'o1js';
import { randomBytes } from 'crypto';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { EthVerifier, ethVerifierVkHash } from '@nori-zk/o1js-zk-utils-new';
import { rootDir } from '../rootDir.js';
import { FungibleToken } from '../TokenBase.js';
import { NoriTokenController } from '../NoriTokenController.js';
import { NoriStorageInterface } from '../NoriStorageInterface.js';
import { type CompilableZkProgramWithAnalyze } from '../types.js';

new LogPrinter('NoriMinaTokenBridge');

const logger = new Logger('CompileZks');

type ContractInfo = {
    name: string;
    contract: typeof SmartContract | CompilableZkProgramWithAnalyze;
};

const contracts: ContractInfo[] = [
    {
        name: 'EthVerifier',
        contract: EthVerifier as unknown as CompilableZkProgramWithAnalyze,
    },
    {
        name: 'NoriStorageInterface',
        contract: NoriStorageInterface,
    },
    {
        name: 'NoriTokenController',
        contract: NoriTokenController,
    },
    {
        name: 'FungibleToken',
        contract: FungibleToken,
    },
];

async function compileAll(cacheDir: string) {
    const vkHashes: Record<string, string> = {};
    const vkData: Record<string, string> = {};

    for (const { name, contract } of contracts) {
        logger.log(`Analyzing methods for ${name}.`);
        const analysis = await contract.analyzeMethods();

        // Log all methods from analyzeMethods
        for (const [methodName, data] of Object.entries(analysis)) {
            logger.log(
                `${name}.${methodName} gates length '${data.gates.length}'.`
            );
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
    const integrityFolder = resolve(rootDir, '..', '..', 'src', 'integrity');
    logger.log(`Writing VK hashes to '${integrityFolder}'`);

    for (const [name, hash] of Object.entries(vkHashes)) {
        if (name === 'EthVerifier') continue;
        const vkHashFilePath = resolve(integrityFolder, `${name}.VkHash.json`);
        writeFileSync(vkHashFilePath, `"${hash}"`, 'utf8');
        logger.log(`Wrote ${name} VK hash to '${vkHashFilePath}'.`);
        const vkDataFilePath = resolve(integrityFolder, `${name}.VkData.json`);
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
        // Step 1: compile/analyze all contracts
        const { vkHashes, vkData } = await compileAll(ephemeralCacheDir);

        // Validate that eth processor vk matches the baked integrity key
        if (ethVerifierVkHash !== vkHashes['EthVerifier']) {
            throw new Error(
                `EthVerifier VK hash does not match baked integrity key.`
            );
        }

        // Step 2: write integrity files
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
