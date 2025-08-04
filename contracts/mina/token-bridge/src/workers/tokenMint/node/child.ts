import { TokenMintWorker } from '../worker.js';
import { WorkerChild } from '../../../worker/child/index.node.js';
import { createWorker } from '../../../worker/index.js';
export const tokenMintWorker = createWorker(new WorkerChild(), TokenMintWorker);