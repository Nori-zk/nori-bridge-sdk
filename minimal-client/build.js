import * as esbuild from "esbuild";
import { config } from "dotenv";

const env = config().parsed || {};
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

async function build() {
  // main thread
  await esbuild.build({
    entryPoints: ["src/index.ts"],
    bundle: true,
    outfile: "public/bundle.js",
    format: "esm",
    define,
    banner: { js: banner },
  });

  // mint worker
  await esbuild.build({
    entryPoints: ["src/mintWorker.ts"],
    bundle: true,
    outfile: "public/mintWorker.js",
    format: "esm",
    define,
    banner: { js: banner },
  });

  // zkapp worker
  await esbuild.build({
    entryPoints: ["src/zkappWorker.ts"],
    bundle: true,
    outfile: "public/zkappWorker.js",
    format: "esm",
    define,
    banner: { js: banner },
  });

  console.log("Build completed successfully.");
}

build().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});