import { Logger, LogPrinter } from '@nori-zk/proof-conversion';
import { resolve } from 'path';
import { Cache } from 'o1js';
import { randomBytes } from 'crypto';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { EthProcessor } from '../ethProcessor.js';
import { rootDir } from '../utils.js';
import { EthVerifier } from '@nori-zk/test-o1js-zk-programs';

new LogPrinter('[NoriEthProcessor]', [
    'log',
    'info',
    'warn',
    'error',
    'debug',
    'fatal',
    'verbose',
]);

const logger = new Logger('CompileZksAndBakeVkHashes');

function writeSuccessDetailsToJsonFiles(
    ethProcessorVKHash: string
) {
    // Write vks
    const ethProcessorVkHashFileOutputPath = resolve(
        rootDir,
        '..',
        'src',
        'integrity',
        'EthProcessor.VkHash.json'
    );
    logger.log(
        `Writing vks hashes to '${ethProcessorVkHashFileOutputPath}'`
    );
    writeFileSync(
        ethProcessorVkHashFileOutputPath,
        `"${ethProcessorVKHash}"`,
        'utf8'
    );
    logger.log(
        `Wrote vks hashes to '${ethProcessorVkHashFileOutputPath}' successfully.`
    );
}

const ephemeralCacheDir = resolve(
    rootDir,
    randomBytes(20).toString('base64').replace(/[+/=]/g, '')
);

async function main() {
    // Create a temporary folder to compile the cache to, this is nessesary as the forceRecompile option
    // seems to be ignored.
    mkdirSync(ephemeralCacheDir, { recursive: true });
    logger.log(
        `Created an ephemeral build cache directory for eth programs '${ephemeralCacheDir}'`
    );

    const verifierMethodsAnalysis = await EthVerifier.analyzeMethods();
    logger.log(
        //prettier-ignore
        `EthVerifier analyze methods gates length '${verifierMethodsAnalysis.compute.gates.length}'.`
    );

    const processorMethodsAnalysis = await EthProcessor.analyzeMethods();
    logger.log(
        //prettier-ignore
        `EthProcessor analyze methods gates length '${processorMethodsAnalysis.update.gates.length}'.`
    );

    // Compile verifier
    logger.log('Compiling EthVerifier.');

    const vk = (
        await EthVerifier.compile({
            cache: Cache.FileSystem(ephemeralCacheDir),
            forceRecompile: true,
        })
    ).verificationKey;
    const ethVerifierVkHash = vk.hash.toString();
    logger.log(`EthVerifier contract compiled vk: '${ethVerifierVkHash}'.`);
    // logger.log(`EthVerifier analyze methods output:\n${JSON.stringify(await EthVerifier.analyzeMethods())}`);

    // Compile processor

    logger.log('Compiling EthProcessor.');
    const pVK = await EthProcessor.compile({
        cache: Cache.FileSystem(ephemeralCacheDir),
        forceRecompile: true,
    });
    const ethProcessorVKHash = pVK.verificationKey.hash.toString();
    logger.log(`EthProcessor contract compiled vk: '${ethProcessorVKHash}'.`);
    // logger.log(`EthProcessor analyze methods output:\n${JSON.stringify(await EthProcessor.analyzeMethods())}`);

    rmSync(ephemeralCacheDir, { recursive: true });
    writeSuccessDetailsToJsonFiles(ethProcessorVKHash);
}

main().catch((err) => {
    logger.fatal(`Main function had an error:\n${String(err.stack)}`);
    rmSync(ephemeralCacheDir, { recursive: true });
    process.exit(1);
});
