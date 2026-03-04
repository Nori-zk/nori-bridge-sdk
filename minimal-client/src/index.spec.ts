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

describe('happy_path_browser', () => {
    /**
     * Full end-to-end happy-path test against a local Lightnet node.
     *

     DEPLOYER_PRIVATE_KEY= ADMIN_PUBLIC_KEY= npm run test --workspace=minimal-client

     * 
     * Requires:
     *   - Lightnet running at http://localhost:8080/graphql
     *   - Lightnet account manager at http://localhost:8181
     *   - DEPLOYER_PRIVATE_KEY env var set to a funded Lightnet account
     *   - ADMIN_PUBLIC_KEY env var set to the desired admin key
     *
     * Runs entirely inside the worker (compile → deploy → update → setUpStorage → noriMint).
     */
    test('happy_path_browser', async () => {
        const deployerPrivateKey = '';
        const adminPublicKey = '';

        if (!deployerPrivateKey || !adminPublicKey) {
            logger.warn(
                'Skipping happy_path_browser: DEPLOYER_PRIVATE_KEY and ADMIN_PUBLIC_KEY must be set.'
            );
            return;
        }

        logger.info('Loading worker for happy path');
        const CompileWorker = getCompileWorker();
        const compileWorker = new CompileWorker();

        logger.info('Running MOCK_happyPath...');
        const result = await compileWorker.MOCK_happyPath(
            deployerPrivateKey,
            adminPublicKey
        );
        logger.log('Happy path result:', result);

    }, 3_600_000); // 1 hour timeout — proving takes time
});