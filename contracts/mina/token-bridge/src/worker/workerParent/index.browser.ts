import { WorkerChildLike } from "./types.js";

export class WorkerParent implements WorkerChildLike {
  private worker: Worker;

  constructor(workerUrl: string) {
    this.worker = new Worker(workerUrl);
  }

  call(data: string): void {
    this.worker.postMessage(data);
  }

  onMessageHandler(callback: (response: string) => void): void {
    this.worker.addEventListener('message', (event) => {
      callback(event.data);
    });
  }

  onErrorHandler(callback: (error: any) => void): void {
    this.worker.addEventListener('error', callback);
  }

  terminate(): void {
    this.worker.terminate();
  }
}
