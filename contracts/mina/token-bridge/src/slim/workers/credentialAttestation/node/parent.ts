import { WorkerParent } from '@nori-zk/workers/node/parent';
import { type CredentialAttestationWorker as CredentialAttestationWorkerType } from '../worker.js';
import { createProxy } from '@nori-zk/workers';
export function getCredentialAttestationWorker() {
    const workerUrl = new URL('./child.js', import.meta.url);
    return createProxy<typeof CredentialAttestationWorkerType>(
        new WorkerParent(workerUrl)
    );
}
