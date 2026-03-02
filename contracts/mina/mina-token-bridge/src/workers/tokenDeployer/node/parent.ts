import { type TokenDeployerWorker as TokenDeployerWorkerType } from '../worker.js';
import { WorkerParent } from '@nori-zk/workers/node/parent';
import { createProxy } from '@nori-zk/workers';
export function getTokenDeployerWorker() {
    const workerUrl = new URL('./child.js', import.meta.url);
    return createProxy<typeof TokenDeployerWorkerType>(
        new WorkerParent(workerUrl)
    );
}
