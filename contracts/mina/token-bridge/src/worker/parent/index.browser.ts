import { DeferredPromise, WorkerParentChildInterface } from '../index.js';

export class WorkerParent implements WorkerParentChildInterface {
    private worker: Worker;
    private deferedReady = new DeferredPromise();

    constructor(worker: Worker) {
        this.worker = worker;
    }

    async ready() {
        return this.deferedReady.promise;
    }

    async call(data: string): Promise<void> {
        await this.ready();
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
