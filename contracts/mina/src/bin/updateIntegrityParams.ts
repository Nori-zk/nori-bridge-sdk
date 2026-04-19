// Load environment variables from .env file
import 'dotenv/config';
import { Field, fetchAccount } from 'o1js';
import { Logger, LogPrinter } from 'esm-iso-logger';
import { FrC } from '@nori-zk/proof-conversion/min';
import {
    bridgeHeadNoriSP1HeliosProgramPi0,
    proofConversionSP1ToPlonkPO2,
} from '@nori-zk/o1js-zk-utils';
import { parseAdminBinEnv, setupNetworkAndCompile, submitAdminTx } from './utils/adminBinUtils.js';

const logger = new Logger('UpdateIntegrityParams');

new LogPrinter('NoriTokenBridge');

// The target pi0 + po2 values are baked into the repo via o1js-zk-utils.
// This script only pushes those repo-pinned values on-chain.
const targetPi0Decimal = bridgeHeadNoriSP1HeliosProgramPi0;
const targetPO2Decimal = proofConversionSP1ToPlonkPO2;
const newPi0 = FrC.from(targetPi0Decimal);
const newPO2 = Field.from(targetPO2Decimal);

const config = parseAdminBinEnv(logger, 'UpdateIntegrityParams');

logger.log(`Target pi0 value (from repo): '${targetPi0Decimal}'`);
logger.log(`Target po2 value (from repo): '${targetPO2Decimal}'`);

async function updateIntegrityParams() {
    const tokenBridge = await setupNetworkAndCompile(logger, config);

    // Read current on-chain state so we can log the diff and skip a no-op tx.
    await fetchAccount({ publicKey: tokenBridge.address });
    const onchainPi0 = await tokenBridge.noriHeliosProgramPi0.fetch();
    const onchainPO2 = await tokenBridge.proofConversionPO2.fetch();

    // Wrap FrC through FrC.from to get a typed handle with toBigInt for logging/compare.
    const onchainPi0Decimal = onchainPi0
        ? FrC.from(onchainPi0).toBigInt().toString()
        : 'unset';
    const onchainPO2Decimal = onchainPO2 ? onchainPO2.toBigInt().toString() : 'unset';

    logger.log(`Current on-chain pi0 value: '${onchainPi0Decimal}'`);
    logger.log(`Current on-chain po2 value: '${onchainPO2Decimal}'`);

    const pi0Matches = onchainPi0Decimal === targetPi0Decimal;
    const po2Matches = onchainPO2Decimal === targetPO2Decimal;

    if (pi0Matches && po2Matches) {
        logger.warn('On-chain pi0 and po2 already match the target values — nothing to do.');
        throw new Error('No update needed: on-chain integrity params already match target values.');
    }
    if (pi0Matches) {
        logger.log('On-chain pi0 already matches the target value.');
        throw new Error('Use the updateNoriHeliosProgramPi0 script to update pi0 independently of po2.');
    }
    if (po2Matches) {
        logger.log('On-chain po2 already matches the target value');
        throw new Error('Use the updateProofConversionPO2 script to update po2 independently of pi0.');
    }

    logger.log('Creating updateIntegrityParams transaction (pi0 + po2)...');
    // Both setters are re-issued even if one side already matches: the no-op case
    // was handled above, and splitting into two txs would double fees + wait time.
    logger.log(`Setting noriHeliosProgramPi0 to: '${targetPi0Decimal}'`);
    logger.log(`Setting proofConversionPO2 to: '${targetPO2Decimal}'`);
    await submitAdminTx(logger, config, async () => {
        await tokenBridge.updateNoriHeliosProgramPi0(newPi0);
        await tokenBridge.updateProofConversionPO2(newPO2);
    });

    logger.log('Integrity params (pi0 + po2) update successful!');
}

updateIntegrityParams().catch((err) => {
    logger.fatal(`UpdateIntegrityParams function encountered an error.\n${String(err)}`);
    process.exit(1);
});
