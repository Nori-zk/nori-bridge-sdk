import {
    bundleTests,
    findBrowser,
    startServer,
} from './browserTestRunnerUtils.js';
import { spawn } from 'child_process';
// import { Logger } from 'esm-iso-logger';

// const logger = new Logger('BrowserNoriTestRunner');

async function main() {
    await bundleTests();

    const { url } = await startServer();
    const browser = findBrowser();

    console.log('Opening browser at', url);

    // V8 flags mirror the o1js Node script's `--no-liftoff
    // --no-wasm-tier-up --max-old-space-size=... --max-semi-space-size=128`,
    // plus `--expose-gc` so the test can poke V8 to GC between
    // compile and prove (drops o1js compile-time garbage that
    // otherwise sits on the heap during prove() and contributes to
    // the OOB / hang). Chromium only accepts V8-level flags through
    // `--js-flags`.
    spawn(
        browser,
        [
            url,
            '--js-flags=--expose-gc --experimental-wasm-memory64 --no-liftoff --no-wasm-tier-up --max-old-space-size=12288 --max-semi-space-size=128',
        ],
        { stdio: 'inherit', detached: true }
    ).unref(); // unref allows Node to exit independently
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
