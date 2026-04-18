import { type TokenBridgeDeployerWorker as TokenBridgeDeployerWorkerType } from '../worker.js';
import { WorkerParent } from '@nori-zk/workers/node/parent';
import { createProxy } from '@nori-zk/workers';

/**
 * @deprecated Deprecated in favour of getTokenBridgeTester
 */
export function getTokenBridgeDeployerWorker() {
    const workerUrl = new URL('./child.js', import.meta.url);
    return createProxy<typeof TokenBridgeDeployerWorkerType>(
        new WorkerParent(workerUrl)
    );
}
