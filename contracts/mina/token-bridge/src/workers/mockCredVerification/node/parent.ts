import { WorkerParent } from '../../../worker/parent/index.node.js';
import { MockVerificationWorker } from '../worker.js';
import { createParent } from '../../../worker/index.js';
const workerUrl = new URL('./child.js', import.meta.url);
export const getMockVerification = () => createParent(new WorkerParent(workerUrl), MockVerificationWorker);
