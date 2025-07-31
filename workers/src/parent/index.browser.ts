import { DeferredPromise, WorkerParentChildInterface } from '../index.js';

export class WorkerParent implements WorkerParentChildInterface {
    private worker: Worker;
    private deferedReady = new DeferredPromise();

    constructor(workerUrl: URL) {
        this.worker = new Worker(workerUrl.href);
    }

    async ready() {
        return this.deferedReady.promise;
    }

    call(data: string): void {
        this.worker.postMessage(data);
    }

    onMessageHandler(callback: (response: string) => void): void {
        this.worker.addEventListener('message', (event) => {
            if (event.data === 'ready') this.deferedReady.resolve();
            else callback(event.data);
        });
    }

    onErrorHandler(callback: (error: any) => void): void {
        this.worker.addEventListener('error', callback);
    }

    terminate(): void {
        this.worker.terminate();
    }
}
