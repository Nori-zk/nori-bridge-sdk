import { TokenMintWorker } from '../worker.js';
import { WorkerChild } from '../../../worker/child/index.browser.js';
import { createWorker } from '../../../worker/index.js';
export const tokenMintWorker = createWorker(new WorkerChild(), TokenMintWorker);