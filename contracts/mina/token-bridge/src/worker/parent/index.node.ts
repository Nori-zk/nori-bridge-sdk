import { Worker } from 'worker_threads';
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
  const baseName = filename.endsWith('.ts') ? filename.slice(0, -3) + '.js' : filename;
  parts.push(baseName);

  const root = isAbsolute ? path.parse(filePath).root : '';

  return path.join(root, ...parts);
}

export class WorkerParent implements WorkerChildLike {
    private worker: Worker;

    constructor(workerScriptPath: URL) {
        this.worker = new Worker(getWorkerUrl(workerScriptPath));
    }

    call(data: string): void {
        this.worker.postMessage(data);
    }

    onMessageHandler(callback: (response: string) => void): void {
        this.worker.on('message', callback);
    }

    onErrorHandler(callback: (error: any) => void): void {
        this.worker.on('error', callback);
    }

    terminate(): void {
        this.worker.terminate();
    }
}
