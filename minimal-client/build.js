import * as esbuild from 'esbuild';
import { config } from 'dotenv';
import fs from 'fs';
import path from 'path';

const HASH = Math.random().toString(36).slice(2, 10);

const env = config().parsed || {};
env.BUILD_HASH = HASH;
const envObject = JSON.stringify(env);

const define = {};
for (const k in env) define[`process.env.${k}`] = JSON.stringify(env[k]);
define['process.env'] = envObject;

const banner = `
if(typeof globalThis.process==='undefined'){
  globalThis.process={env:${envObject}};
}else if(!globalThis.process.env){
  globalThis.process.env=${envObject};
}
`;

function writeHtml(bundleFileName) {
    const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Minting example</title>
  </head>
  <body>
    <h1>Minting example</h1>
    <script type="module" src="./${bundleFileName}"></script>
  </body>
</html>`;
    fs.writeFileSync(path.resolve('public/index.html'), html, 'utf8');
}

async function buildWorkers() {
    // Build first workers
    const firstMintWorker = `first.mintWorker.${HASH}.js`;
    const firstZkappWorker = `first.zkappWorker.${HASH}.js`;

    await esbuild.build({
        entryPoints: ['src/first/mintWorker.ts'],
        bundle: true,
        outfile: `public/${firstMintWorker}`,
        format: 'esm',
        define,
        banner: { js: banner },
    });

    await esbuild.build({
        entryPoints: ['src/first/zkappWorker.ts'],
        bundle: true,
        outfile: `public/${firstZkappWorker}`,
        format: 'esm',
        define,
        banner: { js: banner },
    });

    // Build slim workers
    const slimMintWorker = `slim.mintWorker.${HASH}.js`;
    const slimZkappWorker = `slim.zkappWorker.${HASH}.js`;

    await esbuild.build({
        entryPoints: ['src/slim/mintWorker.ts'],
        bundle: true,
        outfile: `public/${slimMintWorker}`,
        format: 'esm',
        define,
        banner: { js: banner },
    });

    await esbuild.build({
        entryPoints: ['src/slim/zkappWorker.ts'],
        bundle: true,
        outfile: `public/${slimZkappWorker}`,
        format: 'esm',
        define,
        banner: { js: banner },
    });

    // Build micro worker
    const microZkAppWorker = `micro.zkAppWorker.${HASH}.js`;
    await esbuild.build({
        entryPoints: ['src/micro/zkAppWorker.ts'],
        bundle: true,
        outfile: `public/${microZkAppWorker}`,
        format: 'esm',
        define,
        banner: { js: banner },
    });
}

async function buildIndex() {
    const bundleFileName = `bundle.${HASH}.js`;
    await esbuild.build({
        entryPoints: ['src/index.ts'],
        bundle: true,
        outfile: `public/${bundleFileName}`,
        format: 'esm',
        define,
        banner: { js: banner },
    });
    writeHtml(bundleFileName);
    console.log('Build completed successfully.');
}

buildIndex()
    .then(() => buildWorkers())
    .catch((err) => {
        console.error('Build failed:', err);
        process.exit(1);
    });
