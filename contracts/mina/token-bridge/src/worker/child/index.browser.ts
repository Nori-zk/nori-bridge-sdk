import type { WorkerParentLike } from '../index.js';

export class WorkerChild implements WorkerParentLike {
    private messageCallback?: (response: string) => void;
    private errorCallback?: (error: any) => void;

    constructor() {
        self.addEventListener('message', (ev: MessageEvent) => {
            const data = ev.data;
            if (typeof data === 'string' && this.messageCallback) {
                this.messageCallback(data);
            } else if (this.messageCallback) {
                this.messageCallback(JSON.stringify(data));
            }
        });

        self.addEventListener('error', (ev: ErrorEvent) => {
            if (this.errorCallback) this.errorCallback(ev.error);
        });
    }

    send(data: string): void {
        self.postMessage(data);
    }

    onMessageHandler(callback: (response: string) => void): void {
        this.messageCallback = callback;
    }

    onErrorHandler(callback: (error: any) => void): void {
        this.errorCallback = callback;
    }

    terminate(): void {
        self.close();
    }
}
