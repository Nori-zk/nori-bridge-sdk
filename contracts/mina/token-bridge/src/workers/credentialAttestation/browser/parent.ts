import { CredentialAttestationWorker } from '../worker.js';
import { WorkerParent } from '../../../worker/parent/index.browser.js';
import { createProxy } from '../../../worker/index.js';

const worker = new Worker(new URL('./child.js', import.meta.url), {
    type: 'module',
});

const workerParent = new WorkerParent(worker);

export const getCredentialAttestationWorker = () =>
    createProxy(workerParent, CredentialAttestationWorker);
