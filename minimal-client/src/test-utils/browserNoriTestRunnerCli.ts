import {
    bundleTests,
    startServer,
} from './browserTestRunnerUtils.js';
import puppeteer from 'puppeteer';
import { Logger } from 'esm-iso-logger';

const logger = new Logger('BrowserNoriTestRunnerCli');

type WindowWithTests = Window & {
    testsFinished?: boolean;
    testsFailures?: number;
};

type Serializable =
    | string
    | number
    | boolean
    | null
    | unknown[]
    | Record<string, unknown>;

function serializeAny(val: unknown): Serializable {
    if (typeof val === 'bigint') return val.toString() + 'n';
    if (typeof val === 'function') return '[Function]';
    if (val instanceof Error) return { message: val.message, stack: val.stack };
    if (Array.isArray(val)) return val.map(serializeAny);

    if (ArrayBuffer.isView(val)) {
        // Treat all ArrayBufferViews as unserializable
        return '[Unserializable]';
    }

    if (val && typeof val === 'object') {
        const valObj = val as Record<string, unknown>;
        const res: Record<string, unknown> = {};
        for (const key of Object.keys(valObj)) {
            try {
                logger.log(valObj[key], key);
                res[key] = serializeAny(valObj[key]);
            } catch {
                res[key] = '[Unserializable]';
            }
        }
        return res;
    }

    return val as Serializable;
}

async function main() {
    await bundleTests();

    const { url } = await startServer();

    console.log('Launching headless browser for tests');

    const browser = await puppeteer.launch({
        headless: true,
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

        // Strip %c format specifiers and their associated CSS args from browser console logs
        const stripped = args[0] && typeof args[0] === 'string' && args[0].includes('%c')
            ? (() => {
                const fmt = args[0].replace(/%c/g, '');
                const cssCount = (args[0].match(/%c/g) || []).length;
                return [fmt, ...args.slice(1 + cssCount)];
            })()
            : args;
        console.log('[browser]', ...stripped);
    });

    await page.goto(url, { waitUntil: 'domcontentloaded' });

    await page.waitForFunction(() => (window as WindowWithTests).testsFinished === true, {
        polling: 100,
        timeout: 0,
    });

    const failuresCount = await page.evaluate(
        () => (window as WindowWithTests).testsFailures || 0
    );

    console.log(`Tests finished. Failures: ${failuresCount}`);
    process.exit(failuresCount ? 1 : 0);
}

main().catch(console.error);
