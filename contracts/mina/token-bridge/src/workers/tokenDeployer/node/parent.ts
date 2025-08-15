import { TokenDeployerWorker } from '../worker.js';
import { WorkerParent } from '../../../worker/parent/index.node.js';
import { createProxy } from '../../../worker/index.js';
const workerUrl = new URL('./child.js', import.meta.url);
export const getTokenDeployerWorker = () => createProxy(new WorkerParent(workerUrl), TokenDeployerWorker);