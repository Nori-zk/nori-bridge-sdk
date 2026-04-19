// Load environment variables from .env file
import 'dotenv/config';
import { Field, fetchAccount } from 'o1js';
import { Logger, LogPrinter } from 'esm-iso-logger';
import { proofConversionSP1ToPlonkPO2 } from '@nori-zk/o1js-zk-utils-new';
import { parseAdminBinEnv, setupNetworkAndCompile, submitAdminTx } from './utils/adminBinUtils.js';

const logger = new Logger('UpdateProofConversionPO2');

new LogPrinter('NoriTokenBridge');

// The target po2 value is baked into the repo via o1js-zk-utils.
// This script only pushes that repo-pinned value on-chain.
const targetPO2Decimal = proofConversionSP1ToPlonkPO2;
const newPO2 = Field.from(targetPO2Decimal);

const config = parseAdminBinEnv(logger, 'UpdateProofConversionPO2');

logger.log(`Target po2 value (from repo): '${targetPO2Decimal}'`);

async function updateProofConversionPO2() {
    const tokenBridge = await setupNetworkAndCompile(logger, config);

    // Read current on-chain state so we can log the diff and skip a no-op tx.
    await fetchAccount({ publicKey: tokenBridge.address });
    const onchainPO2 = await tokenBridge.proofConversionPO2.fetch();
    const onchainPO2Decimal = onchainPO2 ? onchainPO2.toBigInt().toString() : 'unset';
    logger.log(`Current on-chain po2 value: '${onchainPO2Decimal}'`);

    if (onchainPO2Decimal === targetPO2Decimal) {
        logger.log('On-chain po2 already matches the target value — nothing to do.');
        return;
    }

    logger.log('Creating updateProofConversionPO2 transaction...');
    logger.log(`Setting proofConversionPO2 to: '${targetPO2Decimal}'`);
    await submitAdminTx(logger, config, async () => {
        await tokenBridge.updateProofConversionPO2(newPO2);
    });

    logger.log('proofConversionPO2 update successful!');
}

updateProofConversionPO2().catch((err) => {
    logger.fatal(`UpdateProofConversionPO2 function encountered an error.\n${String(err)}`);
    process.exit(1);
});
