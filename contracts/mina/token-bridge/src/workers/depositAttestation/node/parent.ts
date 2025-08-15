import { WorkerParent } from '../../../worker/parent/index.node.js';
import { DepositAttestationWorker } from '../worker.js';
import { createProxy } from '../../../worker/index.js';
const workerUrl = new URL('./child.js', import.meta.url);
export const getDepositAttestationWorker = () => createProxy(new WorkerParent(workerUrl), DepositAttestationWorker);
