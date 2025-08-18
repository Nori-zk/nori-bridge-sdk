import { WorkerParent } from '../../parent/index.node.js';
import { type EchoWorker } from '../worker.js';
import { createProxy } from '../../index.js';
const workerUrl = new URL('./child.js', import.meta.url);
export const EchoWorkerParent = createProxy<typeof EchoWorker>(new WorkerParent(workerUrl));
