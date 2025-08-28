import { createProxy } from '@nori-zk/workers';
import { WorkerParent } from '@nori-zk/workers/browser/parent';
import { type TokenMintWorker as TokenMintWorkerType } from '@nori-zk/mina-token-bridge/slim/workers/defs';
import { JsonProof, NetworkId } from 'o1js';

export function getTokenMintWorker() {
    const worker = new Worker(
        new URL(`./slim.mintWorker.${process.env.BUILD_HASH}.js`, import.meta.url),
        {
            type: 'module',
        }
    );
    const workerParent = new WorkerParent(worker);
    return createProxy<typeof TokenMintWorkerType>(workerParent);
}
