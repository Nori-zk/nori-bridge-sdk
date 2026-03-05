import { createProxy } from '@nori-zk/workers';
import { WorkerParent } from '@nori-zk/workers/browser/parent';
import { type TokenBridgeWorker as TokenBridgeWorkerType } from '@nori-zk/mina-token-bridge-new/workers/defs';

export function getTokenBridgeWorker() {
    const worker = new Worker(
        new URL(`./tokenBridgeWorker.${process.env.BUILD_HASH}.js`, import.meta.url),
        {
            type: 'module',
        }
    );
    const workerParent = new WorkerParent(worker);
    return createProxy<typeof TokenBridgeWorkerType>(workerParent);
}
