import {
    bundleTests,
    findBrowser,
    startServer,
    ROOT_DIR,
} from './browserTestRunnerUtils.js';
import { spawn } from 'child_process';
import { Logger } from 'esm-iso-logger';

const logger = new Logger('BrowserNoriTestRunner');

async function main() {
    await bundleTests();

    const { url } = await startServer();
    const browser = findBrowser();

    logger.log('Opening browser at', url);

    spawn(browser, [url], { stdio: 'inherit', detached: true }).unref(); // unref allows Node to exit independently
}

main().catch(logger.error);
