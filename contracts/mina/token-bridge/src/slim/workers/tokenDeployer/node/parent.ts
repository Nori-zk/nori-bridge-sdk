import { type TokenDeployerWorker as TokenDeployerWorkerType } from '../worker.js';
import { WorkerParent } from '@nori-zk/workers/node/parent';
import { createProxy } from '@nori-zk/workers';
const workerUrl = new URL('./child.js', import.meta.url);
export const TokenDeployerWorker = createProxy<typeof TokenDeployerWorkerType>(
    new WorkerParent(workerUrl)
);
