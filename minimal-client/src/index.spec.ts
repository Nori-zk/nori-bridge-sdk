import { Logger, LogPrinter } from 'esm-iso-logger';
import { describe, test } from './test-utils/browserTestRunner.js'
import { getCompileWorker } from './compileWorkerClient.js';

new LogPrinter('MinimalClient');
const logger = new Logger('IndexSpec');

describe('compile_all_browser', () => {
    test('compile_all_browser', async () => {
        logger.info('Loading worker');
        const CompileWorker = getCompileWorker();
        const compileWorker = new CompileWorker();
        logger.info('Calling compile');
        await compileWorker.compile();
        logger.log('Compile done!');

    }, 3_600_000); // 1 hour timeout
});