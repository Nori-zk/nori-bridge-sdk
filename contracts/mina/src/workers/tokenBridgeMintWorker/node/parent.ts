import { type TokenBridgeMintWorker as TokenBridgeMintWorkerType } from '../worker.js';
import { WorkerParent } from '@nori-zk/workers/node/parent';
import { createProxy } from '@nori-zk/workers';
export function getTokenBridgeMintWorker() {
    const workerUrl = new URL('./child.js', import.meta.url);
    return createProxy<typeof TokenBridgeMintWorkerType>(new WorkerParent(workerUrl));
}
