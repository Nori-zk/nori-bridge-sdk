import { CompileWorker } from '@nori-zk/mina-token-bridge-new';
import { WorkerChild } from '@nori-zk/workers/browser/child';
import { createWorker } from '@nori-zk/workers';
import { Logger } from 'esm-iso-logger';

const logger = new Logger('ZkAppWorker');

createWorker(new WorkerChild(), CompileWorker);
logger.log('ZkAppWorker has inited!');
