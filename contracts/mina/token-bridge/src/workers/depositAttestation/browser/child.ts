import { DepositAttestationWorker } from '../worker.js';
import { WorkerChild } from '../../../worker/child/index.browser.js';
import { createWorker } from '../../../worker/index.js';
export const depositAttestationWorker = createWorker(new WorkerChild(), DepositAttestationWorker);