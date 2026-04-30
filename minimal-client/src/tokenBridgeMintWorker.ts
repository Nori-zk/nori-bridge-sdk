import { TokenBridgeMintWorker } from '@nori-zk/mina-token-bridge/workers/tokenBridgeMintWorker';
import { WorkerChild } from '@nori-zk/workers/browser/child';
import { createWorker } from '@nori-zk/workers';
import { Logger } from 'esm-iso-logger';

const logger = new Logger('TokenBridgeMintWorker');

createWorker(new WorkerChild(), TokenBridgeMintWorker);
logger.log('TokenBridgeMintWorker has inited!');
