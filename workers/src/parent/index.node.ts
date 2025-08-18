import { fork, ChildProcess } from 'child_process';
import { DeferredPromise, type WorkerParentChildInterface } from '../index.js';
import path from 'path';
import ts from 'typescript';
import fs from 'fs';
import { fileURLToPath } from 'url';

let compilerOptionsCache: ts.CompilerOptions | null = null;

/** Recursively look up from a start directory to find tsconfig.json */
function findTSConfig(startDir: string): string | null {
    let dir = path.resolve(startDir);
    while (true) {
        const candidate = path.join(dir, 'tsconfig.json');
        if (fs.existsSync(candidate)) return candidate;
        const parent = path.dirname(dir);
        if (parent === dir) break; // reached filesystem root
        dir = parent;
    }
    return null;
}

function loadTSConfig(scriptPath: string): ts.CompilerOptions {
    if (compilerOptionsCache) return compilerOptionsCache;

    try {
        const configPath = findTSConfig(path.dirname(scriptPath));
        if (!configPath) {
            console.warn('tsconfig.json not found, using defaults.');
            compilerOptionsCache = {};
            return compilerOptionsCache;
        }

        const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
        const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath));
        compilerOptionsCache = parsed.options;
        return compilerOptionsCache;
    } catch (err) {
        console.error('Error loading tsconfig.json, falling back to defaults:', err);
        compilerOptionsCache = {};
        return compilerOptionsCache;
    }
}

/** Resolves a worker URL to its emitted JS path using tsconfig.json */
export function getWorkerUrl(url: URL): string {
    try {
        const filePath = fileURLToPath(url);
        const opts = loadTSConfig(filePath);

        const rootDir = opts.rootDir ?? '.';
        const outDir = opts.outDir ?? 'build';

        const relPath = path.relative(rootDir, filePath);
        const jsFile = relPath.replace(/\.(ts|mts|cts)$/, '.js');

        return path.resolve(outDir, jsFile);
    } catch (err) {
        console.error('Error resolving worker URL, returning fallback path:', err);
        const fallback = path.resolve('build', path.basename(fileURLToPath(url)).replace(/\.(ts|mts|cts)$/, '.js'));
        return fallback;
    }
}

export class WorkerParent implements WorkerParentChildInterface {
    private child: ChildProcess;
    private messageCallback: (response: string) => void;
    private errorCallback: (response: string) => void;
    constructor(scriptPath: URL) {
        const resolvedPath = getWorkerUrl(scriptPath);
        this.child = fork(resolvedPath, [], {
            stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
        });
        this.child.on('message', (msg) => {
            if (this.messageCallback) {
                if (typeof msg === 'string') {
                    this.messageCallback(msg);
                } else {
                    this.messageCallback(JSON.stringify(msg));
                }
            } else
                console.warn(
                    'Callback for messages not assigned. Call onMessageHandler first.'
                );
        });

        this.child.on('error', (error) => {
            if (this.errorCallback) this.errorCallback(error.message);
            else
                console.warn(
                    'ErrorCallback for error not assigned. Call onErrorHandler first.'
                );
        });
    }

    async send(data: string): Promise<void> {
        this.child.send?.(data);
    }

    onMessageHandler(callback: (response: string) => void): void {
        this.messageCallback = callback;
    }

    onErrorHandler(callback: (error: any) => void): void {
        this.errorCallback = callback;
    }

    terminate(): void {
        this.child.removeAllListeners();
        this.child.kill();
    }
}
