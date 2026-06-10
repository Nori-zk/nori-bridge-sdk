// Load environment variables from .env file
import 'dotenv/config';
import { fetchAccount } from 'o1js';
import { Logger, LogPrinter } from 'esm-iso-logger';
import { FrC } from '@nori-zk/proof-conversion/min';
import { bridgeHeadNoriSP1HeliosProgramPi0 } from '@nori-zk/o1js-zk-utils';
import { parseAdminBinEnv, setupNetworkAndCompile, submitAdminTx } from './utils/adminBinUtils.js';

const logger = new Logger('UpdateNoriHeliosProgramPi0');

new LogPrinter('NoriTokenBridge');

// The target pi0 value is baked into the repo via o1js-zk-utils.
// This script only pushes that repo-pinned value on-chain.
const targetPi0Decimal = bridgeHeadNoriSP1HeliosProgramPi0;
const newPi0 = FrC.from(targetPi0Decimal);

const config = parseAdminBinEnv(logger, 'UpdateNoriHeliosProgramPi0');

logger.log(`Target pi0 value (from repo): '${targetPi0Decimal}'`);

async function updateNoriHeliosProgramPi0() {
    const tokenBridge = await setupNetworkAndCompile(logger, config);

    // Read current on-chain state so we can log the diff and skip a no-op tx.
    await fetchAccount({ publicKey: tokenBridge.address });
    const onchainPi0 = await tokenBridge.noriHeliosProgramPi0.fetch();
    // Wrap through FrC.from to get a typed handle with toBigInt for logging/compare.
    const onchainPi0Decimal = onchainPi0
        ? FrC.from(onchainPi0).toBigInt().toString()
        : 'unset';
    logger.log(`Current on-chain pi0 value: '${onchainPi0Decimal}'`);

    if (onchainPi0Decimal === targetPi0Decimal) {
        logger.log('On-chain pi0 already matches the target value — nothing to do.');
        return;
    }

    logger.log('Creating updateNoriHeliosProgramPi0 transaction...');
    logger.log(`Setting noriHeliosProgramPi0 to: '${targetPi0Decimal}'`);
    await submitAdminTx(logger, config, async () => {
        await tokenBridge.updateNoriHeliosProgramPi0(newPi0);
    });

    logger.log('noriHeliosProgramPi0 update successful!');
}

updateNoriHeliosProgramPi0().catch((err) => {
    logger.fatal(`UpdateNoriHeliosProgramPi0 function encountered an error.\n${String(err)}`);
    process.exit(1);
});
