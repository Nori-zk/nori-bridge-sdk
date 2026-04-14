// Load environment variables from .env file
import 'dotenv/config';
import { Field } from 'o1js';
import { Logger, LogPrinter } from 'esm-iso-logger';
import { parseAdminBinEnv, setupNetworkAndCompile, submitAdminTx } from './adminBinUtils.js';

const logger = new Logger('SetProofConversionPO2');

new LogPrinter('NoriTokenBridge');

const possiblePO2Value = process.argv[2];

const config = parseAdminBinEnv(logger, 'SetProofConversionPO2', (issues) => {
    if (!possiblePO2Value)
        issues.push('Missing required first argument: po2 value (decimal string)');
});

const newPO2 = Field.from(possiblePO2Value);
logger.log(`New po2 value: '${possiblePO2Value}'`);

async function setProofConversionPO2() {
    const tokenBridge = await setupNetworkAndCompile(logger, config);

    logger.log('Creating setProofConversionPO2 transaction...');
    await submitAdminTx(logger, config, async () => {
        logger.log(`Setting proofConversionPO2 to: '${possiblePO2Value}'`);
        await tokenBridge.setProofConversionPO2(newPO2);
    });

    logger.log('proofConversionPO2 update successful!');
}

setProofConversionPO2().catch((err) => {
    logger.fatal(`SetProofConversionPO2 function encountered an error.\n${String(err)}`);
    process.exit(1);
});
