import { parentPort } from 'worker_threads';
import type { WorkerParentLike } from '../types.js';

export class WorkerChild implements WorkerParentLike {
    private messageCallback?: (response: string) => void;
    private errorCallback?: (error: any) => void;

    constructor() {
        parentPort?.on('message', (msg) => {
            if (typeof msg === 'string' && this.messageCallback) {
                this.messageCallback(msg);
            } else if (this.messageCallback) {
                this.messageCallback(JSON.stringify(msg));
            }
        });

        parentPort?.on('error', (err) => {
            if (this.errorCallback) this.errorCallback(err);
        });
    }

    send(data: string): void {
        parentPort?.postMessage(data);
    }

    onMessageHandler(callback: (response: string) => void): void {
        this.messageCallback = callback;
    }

    onErrorHandler(callback: (error: any) => void): void {
        this.errorCallback = callback;
    }

    terminate(): void {
        parentPort?.removeAllListeners();
    }
}
