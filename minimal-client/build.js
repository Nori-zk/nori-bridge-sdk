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
    // Build zkApp worker
    const zkAppWorker = `zkAppWorker.${HASH}.js`;
    await esbuild.build({
        entryPoints: ['src/zkAppWorker.ts'],
        bundle: true,
        outfile: `public/${zkAppWorker}`,
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
