import {
    bundleTests,
    findBrowser,
    startServer,
    ROOT_DIR,
} from './browserTestRunnerUtils.js';
import puppeteer from 'puppeteer';

function serializeAny(val: any): any {
    if (typeof val === 'bigint') return val.toString() + 'n';
    if (typeof val === 'function') return '[Function]';
    if (val instanceof Error) return { message: val.message, stack: val.stack };
    if (Array.isArray(val)) return val.map(serializeAny);

    if (ArrayBuffer.isView(val)) {
        // Treat all ArrayBufferViews as unserializable
        return '[Unserializable]';
    }

    if (val && typeof val === 'object') {
        const res: any = {};
        for (const key of Object.keys(val)) {
            try {
                console.log(val[key], key);
                res[key] = serializeAny(val[key]);
            } catch {
                res[key] = '[Unserializable]';
            }
        }
        return res;
    }

    return val;
}

async function main() {
    await bundleTests();

    const { url } = await startServer();

    const browserPath = findBrowser();
    console.log('Launching headless browser for tests');

    const browser = await puppeteer.launch({
        headless: true,
        executablePath: browserPath,
        protocolTimeout: 0
    });

    const page = await browser.newPage();

    page.on('console', async (msg) => {
        const args = await Promise.all(
            msg.args().map(async (a) => {
                try {
                    return await a.jsonValue();
                } catch {
                    try {
                        return await a.evaluate(
                            (v, serializer) => serializer(v),
                            serializeAny
                        );
                    } catch {
                        return '[Unserializable]';
                    }
                }
            })
        );

        // Skip empty console messages
        if (
            args.length === 0 ||
            (args.length === 1 &&
                (args[0] === '' || args[0] === null || args[0] === undefined))
        )
            return;

        console.log('[browser]', ...args);
    });

    await page.goto(url, { waitUntil: 'domcontentloaded' });

    await page.waitForFunction(() => (window as any).testsFinished === true, {
        polling: 100,
        timeout: 0,
    });

    const failuresCount = await page.evaluate(
        () => (window as any).testsFailures || 0
    );

    console.log(`Tests finished. Failures: ${failuresCount}`);
    process.exit(failuresCount ? 1 : 0);
}

main().catch(console.error);
