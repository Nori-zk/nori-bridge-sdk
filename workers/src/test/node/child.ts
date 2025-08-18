import { EchoWorker } from '../worker.js';
import { WorkerChild } from '../../child/index.node.js';
import { createWorker } from '../../index.js';
createWorker(new WorkerChild(), EchoWorker);