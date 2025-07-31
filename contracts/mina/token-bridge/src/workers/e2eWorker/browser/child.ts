import { E2eWorker } from '../worker.js';
import { WorkerChild } from '../../../worker/child/index.browser.js';
import { createWorker } from '../../../worker/index.js';
export const e2eWorker = createWorker(new WorkerChild(), E2eWorker);