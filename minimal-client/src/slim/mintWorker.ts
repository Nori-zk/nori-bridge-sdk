import { TokenMintWorker } from '@nori-zk/mina-token-bridge/slim/workers/defs';
import { WorkerChild } from '@nori-zk/workers/browser/child';
import { createWorker } from '@nori-zk/workers';
createWorker(new WorkerChild(), TokenMintWorker);
console.log('Mint worker has inited!');
