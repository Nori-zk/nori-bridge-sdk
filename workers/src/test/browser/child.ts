import { EchoWorker } from '../worker.js';
import { WorkerChild } from '../../child/index.browser.js';
import { createWorker } from '../../index.js';
export const echoWorkerChild = createWorker(new WorkerChild(), EchoWorker);