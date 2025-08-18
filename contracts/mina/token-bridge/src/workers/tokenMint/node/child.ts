import { TokenMintWorker } from '../worker.js';
import { WorkerChild } from '@nori-zk/workers/node/child';
import { createWorker } from '@nori-zk/workers';
createWorker(new WorkerChild(), TokenMintWorker);