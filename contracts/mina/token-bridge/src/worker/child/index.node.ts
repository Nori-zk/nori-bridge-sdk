import type { WorkerChildParentInterface } from '../index.js';

export class WorkerChild implements WorkerChildParentInterface {
    private messageCallback?: (response: string) => void;
    private errorCallback?: (error: any) => void;
    private proc: NodeJS.Process;

    constructor(proc: NodeJS.Process = process) {
        this.proc = proc;

        this.proc.on('message', (msg) => {
            if (typeof msg === 'string' && this.messageCallback) {
                this.messageCallback(msg);
            } else if (this.messageCallback) {
                this.messageCallback(JSON.stringify(msg));
            }
        });

        this.proc.on('error', (err) => {
            if (this.errorCallback) this.errorCallback(err);
        });

        this.proc.send('ready');
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
    }
}
