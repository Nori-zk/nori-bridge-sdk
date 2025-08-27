import { type TokenMintWorkerSlim as TokenMintWorkerType } from '../worker.js';
import { WorkerParent } from '@nori-zk/workers/node/parent';
import { createProxy } from '@nori-zk/workers';
export function getTokenMintWorker() {
    const workerUrl = new URL('./child.js', import.meta.url);
    return createProxy<typeof TokenMintWorkerType>(new WorkerParent(workerUrl));
}
