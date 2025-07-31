import { WorkerParent } from '../../parent/index.node.js';
import { EchoWorker } from '../worker.js';
import { createParent } from '../../index.js';
const workerUrl = new URL('./child.js', import.meta.url);
//console.log('workerUrl', workerUrl, import.meta.url);
export const echoWorkerParent = createParent(new WorkerParent(workerUrl), EchoWorker);
