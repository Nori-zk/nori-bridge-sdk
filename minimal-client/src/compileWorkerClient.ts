import { createProxy } from '@nori-zk/workers';
import { WorkerParent } from '@nori-zk/workers/browser/parent';
import { type CompileWorker as CompileWorkerType } from '@nori-zk/mina-token-bridge-new';

export function getCompileWorker() {
    const worker = new Worker(
        new URL(`./compileWorker.${process.env.BUILD_HASH}.js`, import.meta.url),
        {
            type: 'module',
        }
    );
    const workerParent = new WorkerParent(worker);
    return createProxy<typeof CompileWorkerType>(workerParent);
}
