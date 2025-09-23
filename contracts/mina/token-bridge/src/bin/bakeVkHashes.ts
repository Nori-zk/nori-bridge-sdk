//import { Logger, LogPrinter } from '@nori-zk/proof-conversion';
import { resolve } from 'path';
import { Cache, SmartContract } from 'o1js'; // ProofBase
import { randomBytes } from 'crypto';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import {
    CompilableZkProgram,
    EthVerifier,
    ethVerifierVkHash,
} from '@nori-zk/o1js-zk-utils';
import { rootDir } from '../rootDir.js';
import { FungibleToken } from '../TokenBase.js';
import { NoriTokenController } from '../NoriTokenController.js';
import { NoriStorageInterface } from '../NoriStorageInterface.js';
//import { type Gate } from 'o1js/dist/node/snarky.js';
//import { type Subclass } from 'o1js/dist/node/lib/util/types.js';

/*new LogPrinter('[NoriMinaTokenBridge]', [
    'log',
    'info',
    'warn',
    'error',
    'debug',
    'fatal',
    'verbose',
]);

const logger = new Logger('CompileZks');*/
const logger = console;

//type ProofClass = Subclass<typeof ProofBase>;
type CompilableZkProgramWithAnalyze = CompilableZkProgram & {
    analyzeMethods: () => Promise<
        Record<
            string,
            {
                actions: number;
                rows: number;
                digest: string;
                gates: any[]; //Gate[];
                proofs: any[]; // ProofClass[];
            }
        >
    >;
};

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
    const results: Record<string, string> = {};

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

        results[name] = vkHash;
    }

    return results;
}

function writeIntegrityFiles(vkHashes: Record<string, string>) {
    const integrityFolder = resolve(rootDir, '..', '..', 'src', 'integrity');
    logger.log(`Writing VK hashes to '${integrityFolder}'`);

    for (const [name, hash] of Object.entries(vkHashes)) {
        if (name === 'EthVerifier') continue;
        const filePath = resolve(integrityFolder, `${name}.VkHash.json`);
        writeFileSync(filePath, `"${hash}"`, 'utf8');
        logger.log(`Wrote ${name} VK hash to '${filePath}'.`);
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
        const vkHashes = await compileAll(ephemeralCacheDir);

        // Validate that eth processor vk matches the baked integrity key
        if (ethVerifierVkHash !== vkHashes['EthVerifier']) {
            throw new Error(
                `EthVerifier VK hash does not match baked integrity key.`
            );
        }

        // Step 2: write integrity files
        writeIntegrityFiles(vkHashes);
    } finally {
        rmSync(ephemeralCacheDir, { recursive: true, force: true });
        logger.log(`Removed ephemeral cache '${ephemeralCacheDir}'`);
    }
}

main().catch((err) => {
    logger.error(`Main function had an error:\n${String(err.stack)}`); // fatal
    rmSync(ephemeralCacheDir, { recursive: true, force: true });
    process.exit(1);
});
