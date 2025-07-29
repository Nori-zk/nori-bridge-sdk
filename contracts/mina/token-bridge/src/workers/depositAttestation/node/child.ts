import { DepositAttestationWorker } from '../worker.js';
import { WorkerChild } from '../../../worker/child/index.node.js';
import { createWorker } from '../../../worker/index.js';
export const depositAttestationWorker = createWorker(new WorkerChild(), DepositAttestationWorker);