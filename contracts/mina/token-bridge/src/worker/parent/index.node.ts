import { fork, ChildProcess } from 'child_process';
import type { WorkerChildLike } from '../index.js';
import path from 'path';

export function getWorkerUrl(url: URL): string {
    let filePath = url.pathname;

    // Windows fix for leading slash in drive letter paths
    if (process.platform === 'win32' && filePath.startsWith('/')) {
        filePath = filePath.slice(1);
    }

    // No decodeURIComponent here if you want platform independence

    const parts = filePath.split(path.sep);

    // On Unix, splitting absolute path starts with '', so remove it but keep root
    const isAbsolute = path.isAbsolute(filePath);
    if (isAbsolute && parts[0] === '') {
        parts.shift();
    }

    const srcIndex = parts.indexOf('src');
    const targetIndex = parts.indexOf('target');

    // Insert 'target' before 'src' only if target is missing
    if (srcIndex !== -1 && targetIndex === -1) {
        parts.splice(srcIndex, 0, 'target');
    }

    // Fix extension
    const filename = parts.pop() ?? '';
    const baseName = filename.endsWith('.ts')
        ? filename.slice(0, -3) + '.js'
        : filename;
    parts.push(baseName);

    const root = isAbsolute ? path.parse(filePath).root : '';

    return path.join(root, ...parts);
}

export class WorkerParent implements WorkerChildLike {
    private child: ChildProcess;
    private isSpawned = false;
    private messageQueue: string[] = [];

    constructor(scriptPath: URL) {
        const resolvedPath = getWorkerUrl(scriptPath);
        this.child = fork(resolvedPath, [], {
            stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
        });

        this.child.on('spawn', () => {
            this.isSpawned = true;

            for (const msg of this.messageQueue) {
                this.child.send?.(msg);
            }

            this.messageQueue = [];
        });
    }

    call(data: string): void {
        console.log('calling call', data);
        if (this.isSpawned) {
            this.child.send?.(data);
        } else {
            this.messageQueue.push(data);
        }
    }

    onMessageHandler(callback: (response: string) => void): void {
        this.child.on('message', (msg) => {
            if (typeof msg === 'string') {
                callback(msg);
            } else {
                callback(JSON.stringify(msg));
            }
        });
    }

    onErrorHandler(callback: (error: any) => void): void {
        this.child.on('error', (error) => {
            console.log('error', error);
            callback(error);
        });
    }

    terminate(): void {
        this.child.removeAllListeners();
        this.child.kill();
    }
}
