import type { WorkerChildParentInterface } from '../index.js';

export class WorkerChild implements WorkerChildParentInterface {
    private messageCallback?: (response: string) => void;
    private errorCallback?: (error: any) => void;
    private proc: NodeJS.Process;

    constructor(proc: NodeJS.Process = process) {
        this.proc = proc;

        this.proc.on('message', (msg) => {
            if (this.messageCallback) {
                if (typeof msg === 'string') {
                    this.messageCallback(msg);
                } else {
                    this.messageCallback(JSON.stringify(msg));
                }
            } else console.warn('Callback for messages not assigned. Call onMessageHandler first.');
        });

        this.proc.on('error', (err) => {
            if (this.errorCallback) this.errorCallback(err);
            else console.warn('ErrorCallback for error not assigned. Call onErrorHandler first.');
        });
    }

    send(data: string): void {
        this.proc.send?.(data);
    }

    onMessageHandler(callback: (response: string) => void): void {
        this.messageCallback = callback;
    }

    onErrorHandler(callback: (error: any) => void): void {
        this.errorCallback = callback;
    }

    terminate(): void {
        this.proc.removeAllListeners();
        this.proc.exit?.(0);
    }
}
