import { type TokenBridgeTester as TokenBridgeTesterType } from '../worker.js';
import { WorkerParent } from '@nori-zk/workers/node/parent';
import { createProxy } from '@nori-zk/workers';
export function getTokenBridgeTester() {
    const workerUrl = new URL('./child.js', import.meta.url);
    return createProxy<typeof TokenBridgeTesterType>(
        new WorkerParent(workerUrl)
    );
}
