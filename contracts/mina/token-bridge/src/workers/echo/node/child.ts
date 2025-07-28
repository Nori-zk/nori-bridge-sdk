import { EchoWorkerChild } from '../child.js';
import { WorkerChild } from '../../../worker/child/index.node.js';

export const echoWorkerChild = new EchoWorkerChild(
    new WorkerChild()
);