import { deployTokenController } from '../deploy.js';
import { Logger, LogPrinter } from 'esm-iso-logger';

new LogPrinter('NoriMinaTokenBridge');
const logger = new Logger('Deploy');

deployTokenController()
    .then(() => process.exit(0))
    .catch((e: unknown) => {
        const error = e as Error;
        logger.fatal(`Deployment failed: ${error.stack}`);
    });
