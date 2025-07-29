import { EchoWorker } from '../worker.js';
import { WorkerChild } from '../../../worker/child/index.node.js';
import { createWorker } from '../../../worker/index.js';
export const echoWorkerChild = createWorker(new WorkerChild(), EchoWorker);