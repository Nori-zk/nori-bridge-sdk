import { WorkerParent } from '../../../worker/parent/index.node.js';
import { DepositAttestationWorker } from '../worker.js';
import { createParent } from '../../../worker/index.js';
const workerUrl = new URL('./child.js', import.meta.url);
export const getDepositAttestationWorker = () => createParent(new WorkerParent(workerUrl), DepositAttestationWorker);
