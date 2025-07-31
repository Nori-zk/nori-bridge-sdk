import { EchoWorker } from '../worker.js';
import { WorkerParent } from '../../parent/index.browser.js';
import { createParent } from '../../index.js';
const workerUrl = new URL('./child.js', import.meta.url);
export const echoWorkerParent = createParent(new WorkerParent(workerUrl), EchoWorker);
