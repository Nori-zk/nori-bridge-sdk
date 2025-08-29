import { type ZkAppWorker as ZkAppWorkerType } from '../worker.js';
import { WorkerParent } from '@nori-zk/workers/node/parent';
import { createProxy } from '@nori-zk/workers';
export function getZkAppWorker() {
    const workerUrl = new URL('./child.js', import.meta.url);
    return createProxy<typeof ZkAppWorkerType>(new WorkerParent(workerUrl));
}
