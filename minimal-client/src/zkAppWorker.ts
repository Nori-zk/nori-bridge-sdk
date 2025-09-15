import { ZkAppWorker } from '@nori-zk/mina-token-bridge/workers/defs';
import { WorkerChild } from '@nori-zk/workers/browser/child';
import { createWorker } from '@nori-zk/workers';
createWorker(new WorkerChild(), ZkAppWorker);
console.log('ZkAppWorker has inited!');
