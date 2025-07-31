import { E2eWorker } from '../worker.js';
import { WorkerParent } from '../../../worker/parent/index.browser.js';
import { createParent } from '../../../worker/index.js';
const workerUrl = new URL('./child.js', import.meta.url);
export const getE2e = () => createParent(new WorkerParent(workerUrl), E2eWorker);
