// Load environment variables from .env file
import 'dotenv/config';
import { Logger, LogPrinter } from 'esm-iso-logger';
import { Bytes32, Bytes32FieldPair } from '@nori-zk/o1js-zk-utils-new';
import { parseAdminBinEnv, setupNetworkAndCompile, submitAdminTx } from './utils/adminBinUtils.js';

const logger = new Logger('UpdateStoreHash');

new LogPrinter('NoriTokenBridge');

const possibleStoreHashHex = process.argv[2];

const config = parseAdminBinEnv(logger, 'UpdateStoreHash', (issues) => {
    if (!possibleStoreHashHex) {
        issues.push('Missing required first argument: storeHashHex');
    } else {
        try {
            Bytes32.fromHex(possibleStoreHashHex);
        } catch (e) {
            issues.push(
                `storeHashHex '${possibleStoreHashHex}' is not a valid 32-byte hex string: ${(e as Error).message}`
            );
        }
    }
});

const storeHash = Bytes32.fromHex(possibleStoreHashHex);
logger.log(`storeHashHex provided: '${possibleStoreHashHex}'`);

async function updateStoreHash() {
    const tokenBridge = await setupNetworkAndCompile(logger, config);

    logger.log('Creating update store hash transaction...');
    await submitAdminTx(logger, config, async () => {
        logger.log(`Updating the store hash to '${possibleStoreHashHex}'.`);
        await tokenBridge.updateStoreHash(Bytes32FieldPair.fromBytes32(storeHash));
    });

    logger.log('Update successful!');
}

updateStoreHash().catch((err) => {
    logger.fatal(
        `UpdateStoreHash function encountered an error.\n${String(err)}`
    );
    process.exit(1);
});
