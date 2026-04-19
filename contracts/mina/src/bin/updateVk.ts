// Load environment variables from .env file
import 'dotenv/config';
import { Logger, LogPrinter } from 'esm-iso-logger';
import { readFileSync } from 'fs';
import { type VerificationKeySafe, vkSafeToVk } from '@nori-zk/o1js-zk-utils-new';
import { parseAdminBinEnv, setupNetworkAndCompile, submitAdminTx } from './utils/adminBinUtils.js';

const logger = new Logger('UpdateVk');

new LogPrinter('NoriTokenBridge');

const possibleVkDataFilePath = process.argv[2];
const possibleVkHashFilePath = process.argv[3];

let vkSafe: VerificationKeySafe | undefined;

const config = parseAdminBinEnv(logger, 'UpdateVk', (issues) => {
    if (!possibleVkDataFilePath)
        issues.push('Missing required first argument: path to new VkData.json');
    if (!possibleVkHashFilePath)
        issues.push('Missing required second argument: path to new VkHash.json');
    if (possibleVkDataFilePath && possibleVkHashFilePath) {
        try {
            const data = JSON.parse(
                readFileSync(possibleVkDataFilePath, 'utf8')
            ) as string;
            const hashStr = JSON.parse(
                readFileSync(possibleVkHashFilePath, 'utf8')
            ) as string;
            vkSafe = { data, hashStr };
        } catch (e) {
            issues.push(
                `Failed to read VK integrity files: ${(e as Error).message}`
            );
        }
    }
});

// Safe after validation — parseAdminBinEnv exits the process if vkSafe is not set.
const newVkHashStr = vkSafe.hashStr;
const newVerificationKey = vkSafeToVk(vkSafe);

logger.log(`New VK hash: '${newVkHashStr}'`);
logger.log(`VkData file: '${possibleVkDataFilePath}'`);
logger.log(`VkHash file: '${possibleVkHashFilePath}'`);

async function updateVk() {
    const tokenBridge = await setupNetworkAndCompile(logger, config);

    logger.log('Creating update VK transaction...');
    await submitAdminTx(logger, config, async () => {
        logger.log(
            `Setting new verification key with hash: '${newVkHashStr}'`
        );
        await tokenBridge.updateVerificationKey(newVerificationKey);
    });

    logger.log('VK update successful!');
}

updateVk().catch((err) => {
    logger.fatal(`UpdateVk function encountered an error.\n${String(err)}`);
    process.exit(1);
});
