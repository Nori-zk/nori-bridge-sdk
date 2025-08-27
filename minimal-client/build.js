import * as esbuild from "esbuild";
import { config } from "dotenv";
import fs from "fs";
import path from "path";

// ---- generate random hash at top ----
const HASH = Math.random().toString(36).slice(2, 10);

const env = config().parsed || {};
env.BUILD_HASH = HASH;
const envObject = JSON.stringify(env);

const define = {};
for (const k in env) define[`process.env.${k}`] = JSON.stringify(env[k]);
define["process.env"] = envObject;

const banner = `
if(typeof globalThis.process==='undefined'){
  globalThis.process={env:${envObject}};
}else if(!globalThis.process.env){
  globalThis.process.env=${envObject};
}
`;

// ---- filenames with hash ----
const files = {
  bundle: `bundle.${HASH}.js`,
  mintWorker: `mintWorker.${HASH}.js`,
  zkappWorker: `zkappWorker.${HASH}.js`,
};

// ---- write index.html dynamically ----
function writeHtml() {
  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Minting example</title>
  </head>
  <body>
    <h1>Minting example</h1>
    <script type="module" src="./${files.bundle}"></script>
  </body>
</html>`;
  fs.writeFileSync(path.resolve("public/index.html"), html, "utf8");
}

async function buildFirst() {
  await esbuild.build({
    entryPoints: ["src/index.ts"],
    bundle: true,
    outfile: `public/${files.bundle}`,
    format: "esm",
    define,
    banner: { js: banner },
  });

  await esbuild.build({
    entryPoints: ["src/first/mintWorker.ts"],
    bundle: true,
    outfile: `public/${files.mintWorker}`,
    format: "esm",
    define,
    banner: { js: banner },
  });

  await esbuild.build({
    entryPoints: ["src/first/zkappWorker.ts"],
    bundle: true,
    outfile: `public/${files.zkappWorker}`,
    format: "esm",
    define,
    banner: { js: banner },
  });

  writeHtml();
  console.log("Build completed successfully.");
}

async function buildSlim() {
  await esbuild.build({
    entryPoints: ["src/index.ts"],
    bundle: true,
    outfile: `public/${files.bundle}`,
    format: "esm",
    define,
    banner: { js: banner },
  });

  await esbuild.build({
    entryPoints: ["src/slim/mintWorker.ts"],
    bundle: true,
    outfile: `public/${files.mintWorker}`,
    format: "esm",
    define,
    banner: { js: banner },
  });

  await esbuild.build({
    entryPoints: ["src/slim/zkappWorker.ts"],
    bundle: true,
    outfile: `public/${files.zkappWorker}`,
    format: "esm",
    define,
    banner: { js: banner },
  });

  writeHtml();
  console.log("Build completed successfully.");
}

buildSlim().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
