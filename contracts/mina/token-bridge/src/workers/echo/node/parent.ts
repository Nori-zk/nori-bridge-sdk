import { EchoWorkerParent } from '../parent.js';
import { WorkerParent, getWorkerUrl } from '../../../worker/parent/index.node.js';

const workerUrl = getWorkerUrl(new URL('./child.js', import.meta.url));
console.log('workerUrl', workerUrl, import.meta.url);

export const echoWorkerParent = new EchoWorkerParent(
    new WorkerParent(workerUrl)
);
