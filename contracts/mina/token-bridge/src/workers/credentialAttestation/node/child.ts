import { CredentialAttestationWorker } from '../worker.js';
import { WorkerChild } from '../../../worker/child/index.node.js';
import { createWorker } from '../../../worker/index.js';
export const credentialAttestationWorker = createWorker(new WorkerChild(), CredentialAttestationWorker);