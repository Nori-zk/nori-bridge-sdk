import { WorkerParent } from '../../../worker/parent/index.node.js';
import { MockVerificationWorker } from '../worker.js';
import { createProxy } from '../../../worker/index.js';
const workerUrl = new URL('./child.js', import.meta.url);
export const getMockVerification = () => createProxy(new WorkerParent(workerUrl), MockVerificationWorker);
