import { createProxy } from '@nori-zk/workers';
import { WorkerParent } from '@nori-zk/workers/browser/parent';
import { type ZkAppWorker as ZkAppWorkerType } from '@nori-zk/mina-token-bridge/workers/defs';

export function getZkAppWorker() {
    const worker = new Worker(
        new URL(`./zkAppWorker.${process.env.BUILD_HASH}.js`, import.meta.url),
        {
            type: 'module',
        }
    );
    const workerParent = new WorkerParent(worker);
    return createProxy<typeof ZkAppWorkerType>(workerParent);
}
