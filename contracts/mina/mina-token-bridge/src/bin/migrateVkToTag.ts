// Load environment variables from .env file
import 'dotenv/config';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { Logger, LogPrinter } from 'esm-iso-logger';
import { rootDir } from '../utils.js';

const logger = new Logger('MigrateVkToTag');

new LogPrinter('NoriTokenBridge');

const targetCommitish = process.argv[2];

if (!targetCommitish) {
    logger.fatal(
        'Missing required first argument: targetCommitish (git tag or commit SHA)'
    );
    process.exit(1);
}

// Get the remote URL of the current repo
let remoteUrl: string;
try {
    remoteUrl = execSync('git remote get-url origin', {
        encoding: 'utf8',
    }).trim();
} catch (e) {
    logger.fatal(`Failed to get git remote URL: ${(e as Error).message}`);
    process.exit(1);
}

logger.log(`Target commitish: '${targetCommitish}'`);
logger.log(`Remote URL: '${remoteUrl}'`);

const tmpDir = mkdtempSync(join(tmpdir(), 'nori-migrate-vk-'));
logger.log(`Created tmp directory: '${tmpDir}'`);

function cleanup() {
    try {
        rmSync(tmpDir, { recursive: true });
        logger.log(`Cleaned up tmp directory: '${tmpDir}'`);
    } catch (e) {
        logger.warn(
            `Failed to clean up tmp directory '${tmpDir}': ${(e as Error).message}`
        );
    }
}

try {
    // Clone and checkout target commitish
    logger.log('Cloning repository...');
    execSync(`git clone "${remoteUrl}" "${tmpDir}"`, { stdio: 'inherit' });
    execSync(`git -C "${tmpDir}" checkout "${targetCommitish}"`, {
        stdio: 'inherit',
    });

    // Install dependencies at the monorepo root
    logger.log('Installing dependencies...');
    execSync('npm ci', { cwd: tmpDir, stdio: 'inherit' });

    // Run bake-vk-hashes in the mina-token-bridge package
    const tmpTokenBridgeDir = join(
        tmpDir,
        'contracts',
        'mina',
        'mina-token-bridge'
    );
    logger.log('Baking VK hashes in target commitish...');
    execSync('npm run bake-vk-hashes', {
        cwd: tmpTokenBridgeDir,
        stdio: 'inherit',
    });

    // Verify the integrity files were not mutated
    logger.log(
        'Verifying integrity files match committed values for this commitish...'
    );
    try {
        execSync(
            'git diff --exit-code -- contracts/mina/mina-token-bridge/src/integrity/',
            { cwd: tmpDir, stdio: 'pipe' }
        );
        logger.log(
            'Integrity files verified: committed values match compiled output.'
        );
    } catch {
        const diff = execSync(
            'git diff -- contracts/mina/mina-token-bridge/src/integrity/',
            { cwd: tmpDir, encoding: 'utf8' }
        );
        logger.fatal(
            [
                `The integrity files committed at '${targetCommitish}' do not match the output of bake-vk-hashes.`,
                `This means the VkHash.json or VkData.json committed at that tag are stale or incorrect.`,
                `The migration cannot proceed safely.`,
                `Diff:\n${diff}`,
            ].join('\n')
        );
        cleanup();
        process.exit(1);
    }

    // Derive paths to integrity files in the tmp clone
    const vkDataPath = join(
        tmpTokenBridgeDir,
        'src',
        'integrity',
        'NoriTokenBridge.VkData.json'
    );
    const vkHashPath = join(
        tmpTokenBridgeDir,
        'src',
        'integrity',
        'NoriTokenBridge.VkHash.json'
    );

    logger.log(`VkData path: '${vkDataPath}'`);
    logger.log(`VkHash path: '${vkHashPath}'`);

    // Run update-vk from the current checkout, pointing at the target integrity files
    const packageRoot = resolve(rootDir, '..');
    logger.log('Running update-vk against target integrity files...');
    execSync(`npm run update-vk -- "${vkDataPath}" "${vkHashPath}"`, {
        cwd: packageRoot,
        stdio: 'inherit',
    });

    cleanup();
    logger.log('VK migration complete.');
} catch (e) {
    logger.fatal(`Migration failed: ${(e as Error).message}`);
    cleanup();
    process.exit(1);
}
