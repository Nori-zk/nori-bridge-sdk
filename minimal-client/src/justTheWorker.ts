import { getZkAppWorker } from './zkAppWorkerClient.js';
console.log('COMPILING BUILD', process.env.BUILD_HASH);
console.log('Compiling ZkAppWorker');
const ZkAppWorker = getZkAppWorker();
const zkAppWorker = new ZkAppWorker();
await zkAppWorker.compileAll();
console.log('zkAppWorker COMPILED', process.env.BUILD_HASH);