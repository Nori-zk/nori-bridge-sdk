import express from 'express';
import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';
import { execSync } from 'child_process';
import * as esbuild from 'esbuild';
import { fileURLToPath } from 'url';
import http from 'http';
import httpProxy from 'http-proxy';
// Load environment variables from .env file
import 'dotenv/config';
import { getStagingEnv } from '@nori-zk/scrap-mina-token-bridge/node';
//import { Logger } from 'esm-iso-logger';

const logger = console;
//const logger = new Logger('BrowserTestRunnerUtils');

// Resolve staging infrastructure config
const stagingEnv = getStagingEnv();
const minaRpcNetworkUrl = stagingEnv.MINA_RPC_NETWORK_URL;
const minaArchiveRpcUrl = stagingEnv.MINA_ARCHIVE_RPC_URL;
const proofConversionServiceUrl = stagingEnv.NORI_PCS_URL;

// Extract base URL for proxy (strip path to avoid doubling paths like /graphql/graphql)
const minaRpcBaseUrl = new URL(minaRpcNetworkUrl).origin;
const minaArchiveRpcBaseUrl = new URL(minaArchiveRpcUrl).origin;


export const __filename = fileURLToPath(import.meta.url);
export const __dirname = path.dirname(__filename);

// Root and public folder
export const ROOT_DIR = path.resolve(__dirname, '..', '..');
export const PUBLIC_DIR = path.resolve(ROOT_DIR, 'public');

// Build hash
const HASH = Math.random().toString(36).slice(2, 10);

// Environment — merge staging infrastructure config with .env secrets
const dotEnv = config().parsed || {};
const env: Record<string, string> = { ...dotEnv };
for (const [k, v] of Object.entries(stagingEnv)) env[k] = String(v);
env.BUILD_HASH = HASH;
const envObject = JSON.stringify(env);
const define: Record<string, string> = {};
for (const k in env) define[`process.env.${k}`] = JSON.stringify(env[k]);
define['process.env'] = envObject;
const banner = `
if(typeof globalThis.process==='undefined'){
  globalThis.process={env:${envObject}};
}else if(!globalThis.process.env){
  globalThis.process.env=${envObject};
}
`;

/** Find a browser executable, preferring Brave */
export function findBrowser(): string {
    const isMac = process.platform === 'darwin';

    if (isMac) {
        const macPaths = [
            '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
            '/Applications/Brave Browser Nightly.app/Contents/MacOS/Brave Browser Nightly',
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
        ];
        for (const p of macPaths) {
            try {
                execSync(`test -x "${p}"`, { encoding: 'utf8' });
                return p;
            } catch {
                // not found, try next
            }
        }
    }

    try {
        return execSync(
            'which google-chrome || which google-chrome-stable || which chrome || which chromium || which brave-browser-nightly || which brave-browser || which brave',
            { encoding: 'utf8' }
        ).trim();
    } catch {
        throw new Error('No supported browser found (Brave or Chrome).');
    }
}

/** Start Express server serving public folder */
export async function startServer(port = 4003) {
    const app = express();

    // CORS + COOP/COEP + no caching
    app.use((req, res, next) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        if (req.method === 'OPTIONS') {
            res.status(204).end();
            return;
        }
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
        res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
        res.setHeader(
            'Cache-Control',
            'no-store, no-cache, must-revalidate, proxy-revalidate'
        );
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Surrogate-Control', 'no-store');
        next();
    });

    // Serve static files
    app.use(express.static(PUBLIC_DIR));

    // HTTP + WS proxy setup
    const proxy = httpProxy.createProxyServer({
        changeOrigin: true,
        ws: true,
        secure: true,
    });

    // Proxy for pcs
    app.use('/converted-consensus-mpt-proofs', (req, res) => {
        proxy.web(req, res, {
            target: `${proofConversionServiceUrl}/converted-consensus-mpt-proofs`,
        });
    });

    // Proxy for archive node
    app.use('/archive', (req, res) => {
        proxy.web(req, res, {
            target: minaArchiveRpcBaseUrl,
        });
    });

    // Catch-all proxy for Mina RPC
    app.use((req, res) => {
        proxy.web(req, res, {
            target: minaRpcBaseUrl,
        });
    });

    proxy.on('error', (err, req, res) => {
        void req;
        void res;
        logger.error('Proxy error:', err.message);
    });

    // Create HTTP server for WebSocket upgrade support
    const server = http.createServer(app);

    server.on('upgrade', (req, socket, head) => {
        logger.log('Upgrade attempt detected:', req.url);
        proxy.ws(req, socket, head);
    });

    return new Promise<{ server: http.Server; url: string }>((resolve) => {
        server.listen(port, () => {
            const url = `http://localhost:${port}/index.html`;
            logger.log(`Server running at: ${url}.`);
            logger.log(`Mina RPC (proxy target): ${minaRpcBaseUrl}`);
            logger.log(`Mina Archive (proxy target): ${minaArchiveRpcBaseUrl}`);
            logger.log(`PCS (proxy target): ${proofConversionServiceUrl}`);
            resolve({ server, url });
        });
    });
}

/* Bundle workers */
async function buildWorkers() {
    // Build token bridge worker
    const tokenBridgeWorkerFileName = `tokenBridgeWorker.${HASH}.js`;
    const tokenBridgeWorkerFilePath = path.resolve(ROOT_DIR, 'public', tokenBridgeWorkerFileName);
    await esbuild.build({
        entryPoints: ['src/tokenBridgeWorker.ts'],
        bundle: true,
        outfile: tokenBridgeWorkerFilePath,
        format: 'esm',
        define,
        banner: { js: banner },
    });
}

/** Bundle all tests into ESM for browser */
export async function bundleTests() {
    const entryFile = path.resolve(ROOT_DIR, 'src/tests/index.ts');

    if (fs.existsSync(PUBLIC_DIR)) fs.rmSync(PUBLIC_DIR, { recursive: true, force: true });

    if (!fs.existsSync(PUBLIC_DIR))
        fs.mkdirSync(PUBLIC_DIR, { recursive: true });

    const outFileName = `bundle.tests.${HASH}.js`;
    const outfile = path.resolve(PUBLIC_DIR, outFileName);

    await esbuild.build({
        entryPoints: [entryFile],
        bundle: true,
        format: 'esm',
        outfile,
        platform: 'browser',
        banner: { js: banner },
        define: { 'process.env.NODE_ENV': '"test"' },
    });

    await buildWorkers();

    // Create a minimal index.html if missing
    const htmlPath = path.resolve(PUBLIC_DIR, 'index.html');
    if (!fs.existsSync(htmlPath)) {
        const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Nori Minimal Client Tests</title></head>
<body>
<h1>Nori Minimal Client Tests</h1>
<div id="test-results"></div>
<script type="module">
  import './${outFileName}';
  window.addEventListener('DOMContentLoaded', () => {
    if (!window.runTests) {
      logger.error('runTests not found on globalThis!');
      return;
    }
    window.runTests();
  });
</script>
</body>
</html>`;
        fs.writeFileSync(htmlPath, html, 'utf-8');
    }

    return outfile;
}
