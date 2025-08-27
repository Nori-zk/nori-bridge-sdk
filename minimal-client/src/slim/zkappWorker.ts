import { CredentialAttestationWorker } from '@nori-zk/mina-token-bridge/slim/workers/defs';
import { WorkerChild } from '@nori-zk/workers/browser/child';
import { createWorker } from '@nori-zk/workers';
createWorker(new WorkerChild(), CredentialAttestationWorker);
console.log('Credential worker has inited!');
