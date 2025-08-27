import { getTokenMintWorker } from './mintWorkerClient.js';
console.log('COMPILING BUILD', process.env.BUILD_HASH);
const TokenMintWorker = getTokenMintWorker();
const tokenMintWorker = new TokenMintWorker();
await tokenMintWorker.compileAll();
console.log('THE LITTLE GUY COMPILED', process.env.BUILD_HASH);