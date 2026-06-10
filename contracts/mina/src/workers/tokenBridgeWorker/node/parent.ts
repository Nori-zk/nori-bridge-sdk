import { type TokenBridgeWorker as TokenBridgeWorkerType } from '../worker.js';
import { WorkerParent } from '@nori-zk/workers/node/parent';
import { createProxy } from '@nori-zk/workers';
export function getTokenBridgeWorker() {
    const workerUrl = new URL('./child.js', import.meta.url);
    return createProxy<typeof TokenBridgeWorkerType>(new WorkerParent(workerUrl));
}
