// Load environment variables from .env file
import 'dotenv/config';
import { Field } from 'o1js';
import { Logger, LogPrinter } from 'esm-iso-logger';
import { FrC } from '@nori-zk/proof-conversion/min';
import { parseAdminBinEnv, setupNetworkAndCompile, submitAdminTx } from './adminBinUtils.js';

const logger = new Logger('SetIntegrityParams');

new LogPrinter('NoriTokenBridge');

const possiblePi0Value = process.argv[2];
const possiblePO2Value = process.argv[3];

const config = parseAdminBinEnv(logger, 'SetIntegrityParams', (issues) => {
    if (!possiblePi0Value)
        issues.push('Missing required first argument: pi0 value (decimal string)');
    if (!possiblePO2Value)
        issues.push('Missing required second argument: po2 value (decimal string)');
});

const newPi0 = FrC.from(possiblePi0Value);
const newPO2 = Field.from(possiblePO2Value);
logger.log(`New pi0 value: '${possiblePi0Value}'`);
logger.log(`New po2 value: '${possiblePO2Value}'`);

async function setIntegrityParams() {
    const tokenBridge = await setupNetworkAndCompile(logger, config);

    logger.log('Creating setIntegrityParams transaction (pi0 + po2)...');
    await submitAdminTx(logger, config, async () => {
        logger.log(`Setting noriHeliosProgramPi0 to: '${possiblePi0Value}'`);
        logger.log(`Setting proofConversionPO2 to: '${possiblePO2Value}'`);
        await tokenBridge.setNoriHeliosProgramPi0(newPi0);
        await tokenBridge.setProofConversionPO2(newPO2);
    });

    logger.log('Integrity params (pi0 + po2) update successful!');
}

setIntegrityParams().catch((err) => {
    logger.fatal(`SetIntegrityParams function encountered an error.\n${String(err)}`);
    process.exit(1);
});
