import { WorkerParent } from '../../../worker/parent/index.node.js';
import { CredentialAttestationWorker } from '../worker.js';
import { createProxy } from '../../../worker/index.js';
const workerUrl = new URL('./child.js', import.meta.url);
export const getCredentialAttestationWorker = () => createProxy(new WorkerParent(workerUrl), CredentialAttestationWorker);
