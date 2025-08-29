import { getZkAppWorker } from './zkAppWorkerClient.js';
console.log('COMPILING BUILD MICRO', process.env.BUILD_HASH);
console.log('Compiling ZkAppWorker');
const ZkAppWorker = getZkAppWorker();
const zkAppWorker = new ZkAppWorker();
await zkAppWorker.compileAll();
console.log('THE LITTLE GUY(zkAppWorker) COMPILED', process.env.BUILD_HASH);