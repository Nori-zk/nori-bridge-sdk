import { createProxy } from '@nori-zk/workers';
import { WorkerParent } from '@nori-zk/workers/browser/parent';
import { type CredentialAttestationWorker as CredentialAttestationWorkerType } from '@nori-zk/mina-token-bridge/workers/defs';

type CredentialAttestationWorkerInst = InstanceType<
    ReturnType<typeof createProxy<typeof CredentialAttestationWorkerType>>
>;

export const noriTokenControllerAddressBase58 =
    'B62qjjbAsmyjEYkUQQbwzVLBxUc66cLp48vxgT582UxK15t1E3LPUNs'; // This should be an env var! Will change in testnet vs production

export function getCredentialWorker() {
    const worker = new Worker(
        new URL(`./zkappWorker.${process.env.BUILD_HASH}.js`, import.meta.url),
        {
            type: 'module',
        }
    );
    const workerParent = new WorkerParent(worker);
    return createProxy<typeof CredentialAttestationWorkerType>(workerParent);
}
