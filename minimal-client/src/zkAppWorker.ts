import { ZkAppWorker } from '@nori-zk/mina-token-bridge/workers/defs';
import { WorkerChild } from '@nori-zk/workers/browser/child';
import { createWorker } from '@nori-zk/workers';
import { Logger } from 'esm-iso-logger';

const logger = new Logger('ZkAppWorker');

createWorker(new WorkerChild(), ZkAppWorker);
logger.log('ZkAppWorker has inited!');
