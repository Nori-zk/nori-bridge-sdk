import { TokenDeployer } from '../worker.js';
import { WorkerParent } from '../../../worker/parent/index.node.js';
import { createParent } from '../../../worker/index.js';
const workerUrl = new URL('./child.js', import.meta.url);
export const getTokenDeployer = () => createParent(new WorkerParent(workerUrl), TokenDeployer);