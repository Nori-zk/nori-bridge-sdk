import { Logger, LogPrinter } from '@nori-zk/proof-conversion';
import { resolve } from 'path';
import { Cache } from 'o1js';
import { randomBytes } from 'crypto';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { EthVerifier } from '../ethVerifier.js';
import { rootDir } from '../rootDir.js';

new LogPrinter('[NoriEthVerifier]', [
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
    ethVerifierVkHash: string,
) {
    // Write vks
    const ethVerifierVkHashFileOutputPath = resolve(
        rootDir,
        '..',
        'src',
        'integrity',
        'EthVerifier.VkHash.json'
    );
    logger.log(
        `Writing vks hashes to '${ethVerifierVkHashFileOutputPath}'`
    );
    writeFileSync(
        ethVerifierVkHashFileOutputPath,
        `"${ethVerifierVkHash}"`,
        'utf8'
    );
    logger.log(
        `Wrote vks hashes to '${ethVerifierVkHashFileOutputPath}' successfully.`
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

    rmSync(ephemeralCacheDir, { recursive: true });
    writeSuccessDetailsToJsonFiles(ethVerifierVkHash);
}

main().catch((err) => {
    logger.fatal(`Main function had an error:\n${String(err.stack)}`);
    rmSync(ephemeralCacheDir, { recursive: true });
    process.exit(1);
});
