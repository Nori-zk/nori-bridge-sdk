import { WorkerParent } from '../../../worker/parent/index.node.js';
import { EchoWorker } from '../worker.js';
import { createProxy } from '../../../worker/index.js';
const workerUrl = new URL('./child.js', import.meta.url);
//console.log('workerUrl', workerUrl, import.meta.url);
export const echoWorkerParent = createProxy(new WorkerParent(workerUrl), EchoWorker);
