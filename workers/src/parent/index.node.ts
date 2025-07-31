import { fork, ChildProcess } from 'child_process';
import { DeferredPromise, type WorkerParentChildInterface } from '../index.js';
import path from 'path';

export function getWorkerUrl(url: URL): string {
    let filePath = url.pathname;

    // Windows fix for leading slash in drive letter paths
    if (process.platform === 'win32' && filePath.startsWith('/')) {
        filePath = filePath.slice(1);
    }

    const parts = filePath.split(path.sep);

    // On Unix, splitting absolute path starts with '', so remove it but keep root
    const isAbsolute = path.isAbsolute(filePath);
    if (isAbsolute && parts[0] === '') {
        parts.shift();
    }

    const srcIndex = parts.indexOf('src');
    const targetIndex = parts.indexOf('build');

    // Insert 'target' before 'src' only if target is missing
    if (srcIndex !== -1 && targetIndex === -1) {
        parts.splice(srcIndex, 0, 'build');
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

export class WorkerParent implements WorkerParentChildInterface {
    private child: ChildProcess;
    private deferedReady = new DeferredPromise();
    constructor(scriptPath: URL) {
        const resolvedPath = getWorkerUrl(scriptPath);
        this.child = fork(resolvedPath, [], {
            stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
        });
    }

    async ready() {
        return this.deferedReady.promise;
    }
    
    call(data: string): void {
        this.child.send?.(data);
    }

    onMessageHandler(callback: (response: string) => void): void {
        this.child.on('message', (msg) => {
            if (msg === 'ready') {
                this.deferedReady.resolve();
            } else if (typeof msg === 'string') {
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
