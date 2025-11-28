import express from 'express';
import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';
import { execSync } from 'child_process';
import * as esbuild from 'esbuild';
import { fileURLToPath } from 'url';
import http from 'http';
import httpProxy from 'http-proxy';

export const __filename = fileURLToPath(import.meta.url);
export const __dirname = path.dirname(__filename);

// Root and public folder
export const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');
export const PUBLIC_DIR = path.resolve(ROOT_DIR, 'public');

// Build hash
const HASH = Math.random().toString(36).slice(2, 10);

// Environment
const env = config().parsed || {};
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

    // COOP/COEP + no caching
    app.use((req, res, next) => {
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

    // Proxy for pcs.nori.it.com
    app.use('/converted-consensus-mpt-proofs', (req, res) => {
        proxy.web(req, res, {
            target: 'https://pcs.nori.it.com/converted-consensus-mpt-proofs',
        });
    });

    // Catch-all proxy for Mina devnet
    app.use((req, res) => {
        proxy.web(req, res, {
            target: 'https://api.minascan.io/node/devnet/v1/graphql',
        });
    });

    // Create HTTP server for WebSocket upgrade support
    const server = http.createServer(app);

    server.on('upgrade', (req, socket, head) => {
        console.log('Upgrade attempt detected:', req.url);
        proxy.ws(req, socket, head);
    });

    return new Promise<{ server: http.Server; url: string }>((resolve) => {
        server.listen(port, () => {
            const url = `http://localhost:${port}/index.html`;
            console.log(
                `Server running at: ${url}. Please open this in brave with the necessary flags.`
            );
            resolve({ server, url });
        });
    });
}

/* Bundle workers */
async function buildWorkers() {
    // Build zkApp worker
    const zkAppWorkerFileName = `zkAppWorker.${HASH}.js`;
    const zkAppWorkerFilePath = path.resolve(ROOT_DIR, 'public', zkAppWorkerFileName);
    await esbuild.build({
        entryPoints: ['src/zkAppWorker.ts'],
        bundle: true,
        outfile: zkAppWorkerFilePath,
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
<head><meta charset="UTF-8"><title>WebGPU Tests</title></head>
<body>
<h1>Nori Minimal Client Tests</h1>
<div id="test-results"></div>
<script type="module">
  import './${outFileName}';
  window.addEventListener('DOMContentLoaded', () => {
    if (!window.runTests) {
      console.error('runTests not found on globalThis!');
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
