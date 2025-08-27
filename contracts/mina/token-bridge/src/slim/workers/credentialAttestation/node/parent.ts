import { WorkerParent } from '@nori-zk/workers/node/parent';
import { type CredentialAttestationWorker as CredentialAttestationWorkerType } from '../worker.js';
import { createProxy } from '@nori-zk/workers';
const workerUrl = new URL('./child.js', import.meta.url);
export const CredentialAttestationWorker = createProxy<
    typeof CredentialAttestationWorkerType
>(new WorkerParent(workerUrl));
