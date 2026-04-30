import { createProxy } from '@nori-zk/workers';
import { WorkerParent } from '@nori-zk/workers/browser/parent';
import { type TokenBridgeMintWorker as TokenBridgeMintWorkerType } from '@nori-zk/mina-token-bridge/workers/tokenBridgeMintWorker';

export function getTokenBridgeMintWorker() {
    const worker = new Worker(
        new URL(`./tokenBridgeMintWorker.${process.env.BUILD_HASH}.js`, import.meta.url),
        {
            type: 'module',
        }
    );
    const workerParent = new WorkerParent(worker);
    return createProxy<typeof TokenBridgeMintWorkerType>(workerParent);
}
