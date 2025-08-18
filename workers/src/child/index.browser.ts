import type { WorkerChildParentInterface } from '../index.js';

export class WorkerChild implements WorkerChildParentInterface {
    private messageCallback?: (response: string) => void;
    private errorCallback?: (error: any) => void;

    constructor() {
        self.addEventListener('message', (ev: MessageEvent) => {
            const data = ev.data;
            if (this.messageCallback) {
                if (typeof data === 'string') {
                    this.messageCallback(data);
                } else {
                    this.messageCallback(JSON.stringify(data));
                }
            }
            else console.warn('Callback for messages not assigned. Call onMessageHandler first.'); 
        });

        self.addEventListener('error', (ev: ErrorEvent) => {
            if (this.errorCallback) this.errorCallback(ev.error);
            else console.warn('ErrorCallback for error not assigned. Call onErrorHandler first.');
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
