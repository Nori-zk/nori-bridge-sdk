import { TokenBridgeWorker } from '@nori-zk/mina-token-bridge-new/workers/defs';
import { WorkerChild } from '@nori-zk/workers/browser/child';
import { createWorker } from '@nori-zk/workers';
import { Logger } from 'esm-iso-logger';

const logger = new Logger('TokenBridgeWorker');

createWorker(new WorkerChild(), TokenBridgeWorker);
logger.log('TokenBridgeWorker has inited!');
