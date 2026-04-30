import { createProxy } from '@nori-zk/workers';
import { WorkerParent } from '@nori-zk/workers/browser/parent';
import {
    TokenBridgeMintWorker,
    type TokenBridgeMintWorker as TokenBridgeMintWorkerType,
} from '@nori-zk/mina-token-bridge/workers/tokenBridgeMintWorker';

// Worker variant — the original wiring. Mint compute runs in a Web
// Worker, which gets its own V8 isolate and WASM memory budget. In
// Chromium, that per-worker budget is often lower than what the main
// thread enjoys, and o1js's mint prove() can hit the WASM linear
// memory cap before it finishes (manifests as
// "RuntimeError: memory access out of bounds" deep inside prove()).
export function getTokenBridgeMintWorker() {
    const worker = new Worker(
        new URL(`./tokenBridgeMintWorker.${process.env.BUILD_HASH}.js`, import.meta.url),
        {
            type: 'module',
        }
    );
    const workerParent = new WorkerParent(worker);
    return createProxy<typeof TokenBridgeMintWorkerType>(workerParent);
}

// Main-thread variant. Returns a constructor whose instances *are*
// `TokenBridgeMintWorker` directly — no Worker boundary, no proxy.
// Trades parallelism (the page is blocked during prove()) for
// access to the main-thread memory budget, which usually gets the
// mint prove() over the WASM-OOB hump.
//
// `terminate` and `signalTerminate` are stubbed because the proxy
// version exposes them and the test calls them on the cleanup path;
// a main-thread instance has no worker to kill.
export function getTokenBridgeMintWorkerMainThread() {
    return class MainThreadMintWorker extends TokenBridgeMintWorker {
        terminate(): void {}
        signalTerminate(): void {}
        ready: Promise<void> = Promise.resolve();
    } as unknown as new () => TokenBridgeMintWorkerType & {
        terminate(): void;
        signalTerminate(): void;
        ready: Promise<void>;
    };
}
