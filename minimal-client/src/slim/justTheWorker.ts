import { getTokenMintWorker } from './mintWorkerClient.js';
const TokenMintWorker = getTokenMintWorker();
const tokenMintWorker = new TokenMintWorker();
await tokenMintWorker.compileAll();
console.log('THE FUCKING LITTLE GUY COMPILED', process.env.BUILD_HASH);