import { type MockWalletWorker as MockWalletWorkerType } from '../worker.js';
import { WorkerParent } from '@nori-zk/workers/node/parent';
import { createProxy } from '@nori-zk/workers';
const workerUrl = new URL('./child.js', import.meta.url);
export const MockWalletWorker = createProxy<typeof MockWalletWorkerType>(
    new WorkerParent(workerUrl)
);
