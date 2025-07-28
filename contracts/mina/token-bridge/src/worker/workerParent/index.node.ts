import { Worker } from 'worker_threads';
import type { WorkerChildLike } from './types.js';

export class WorkerParent implements WorkerChildLike {
  private worker: Worker;

  constructor(workerScriptPath: string) {
    this.worker = new Worker(workerScriptPath);
  }

  call(data: string): void {
    this.worker.postMessage(data);
  }

  onMessageHandler(callback: (response: string) => void): void {
    this.worker.on('message', callback);
  }

  onErrorHandler(callback: (error: any) => void): void {
    this.worker.on('error', callback);
  }

  terminate(): void {
    this.worker.terminate();
  }
}
