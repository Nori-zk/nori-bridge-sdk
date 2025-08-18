import { type EchoWorker } from '../worker.js';
import { WorkerParent } from '../../parent/index.browser.js';
import { createProxy } from '../../index.js';

const worker = new Worker(new URL('./child.js', import.meta.url), {
    type: 'module',
});

const workerParent = new WorkerParent(worker);

export const EchoWorkerParent = createProxy<typeof EchoWorker>(workerParent);
