import { type TokenMintWorker as TokenMintWorkerType } from '../worker.js';
import { WorkerParent } from '@nori-zk/workers/node/parent';
import { createProxy } from '@nori-zk/workers';
const workerUrl = new URL('./child.js', import.meta.url);
export const TokenMintWorker = createProxy<typeof TokenMintWorkerType>(new WorkerParent(workerUrl));