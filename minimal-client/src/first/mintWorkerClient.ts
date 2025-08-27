import { createProxy } from '@nori-zk/workers';
import { WorkerParent } from '@nori-zk/workers/browser/parent';
import { type TokenMintWorker as TokenMintWorkerType } from '@nori-zk/mina-token-bridge/workers/defs';
import { JsonProof, NetworkId } from 'o1js';

type TokenMintWorkerInst = InstanceType<
    ReturnType<typeof createProxy<typeof TokenMintWorkerType>>
>;

export const noriTokenControllerAddressBase58 =
    'B62qjjbAsmyjEYkUQQbwzVLBxUc66cLp48vxgT582UxK15t1E3LPUNs';
export const noriTokenBaseBase58 =
    'B62qjRLSRy5M1eEndnDyvT9ND8wdiNE3UpnH1KSoTgQyEtwNgDfebxx';

export function getTokenMintWorker() {
    const worker = new Worker(
        new URL(`./mintWorker.${process.env.BUILD_HASH}.js`, import.meta.url),
        {
            type: 'module',
        }
    );
    const workerParent = new WorkerParent(worker);
    return createProxy<typeof TokenMintWorkerType>(workerParent);
}
