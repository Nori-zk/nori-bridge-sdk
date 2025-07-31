import { E2eWorker } from '../worker.js';
import { WorkerChild } from '../../../worker/child/index.node.js';
import { createWorker } from '../../../worker/index.js';
export const e2eWorker = createWorker(new WorkerChild(), E2eWorker);