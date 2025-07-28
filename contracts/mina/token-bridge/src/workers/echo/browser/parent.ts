import { EchoWorkerParent } from '../parent.js';
import { WorkerParent } from '../../../worker/parent/index.browser.js';

const workerUrl = new URL('./child.js', import.meta.url).href;

export const echoWorkerParent = new EchoWorkerParent(
    new WorkerParent(workerUrl)
);
