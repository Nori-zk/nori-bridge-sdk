import { createProxy } from '@nori-zk/workers';
import { WorkerParent } from '@nori-zk/workers/browser/parent';
import { type CredentialAttestationWorker as CredentialAttestationWorkerType } from '@nori-zk/mina-token-bridge/slim/workers/defs';

export function getCredentialWorker() {
    const worker = new Worker(
        new URL(`./slim.zkappWorker.${process.env.BUILD_HASH}.js`, import.meta.url),
        {
            type: 'module',
        }
    );
    const workerParent = new WorkerParent(worker);
    return createProxy<typeof CredentialAttestationWorkerType>(workerParent);
}
