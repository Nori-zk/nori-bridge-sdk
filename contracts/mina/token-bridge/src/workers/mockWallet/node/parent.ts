import { MockWalletWorker } from '../worker.js';
import { WorkerParent } from '../../../worker/parent/index.node.js';
import { createProxy } from '../../../worker/index.js';
const workerUrl = new URL('./child.js', import.meta.url);
export const getMockWalletWorker = () => createProxy(new WorkerParent(workerUrl), MockWalletWorker);