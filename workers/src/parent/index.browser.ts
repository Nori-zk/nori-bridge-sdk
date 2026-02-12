import { DeferredPromise, WorkerParentChildInterface } from '../index.js';
import { Logger } from 'esm-iso-logger';

const logger = new Logger('WorkerParentBrowser');

export class WorkerParent implements WorkerParentChildInterface {
    private worker: Worker;
    private messageCallback: (response: string) => void;
    private errorCallback: (response: string) => void;
    constructor(worker: Worker) {
        this.worker = worker;
        this.worker.addEventListener('message', (event) => {
            if (this.messageCallback) this.messageCallback(event.data);
            else logger.warn('Callback for messages not assigned. Call onMessageHandler first.');
        });

        this.worker.addEventListener('error', (error) => {
            if (this.errorCallback) this.errorCallback(error.message);
            else logger.warn('ErrorCallback for error not assigned. Call onErrorHandler first.');
        });
    }

    send(msg: string) {
        this.worker.postMessage(msg);
    }

    onMessageHandler(callback: (response: string) => void): void {
        this.messageCallback = callback;
    }

    onErrorHandler(callback: (error: any) => void): void {
        this.errorCallback = callback;
    }

    terminate(): void {
        logger.log('Calling terminate on worker', this.worker, this);
        this.worker.terminate();
    }
}
