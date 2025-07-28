import { EchoWorkerChild } from '../child.js';
import { WorkerChild } from '../../../worker/child/index.browser.js';

export const echoWorkerChild = new EchoWorkerChild(
    new WorkerChild()
);
