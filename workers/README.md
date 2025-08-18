# Workers

A library to enable creating and using workers within a browser and Node.js context.

# Define a worker

```typescript
// Simulate long import time due to top level async
await new Promise((res) => setTimeout(res, 10000));

export class EchoWorker {
    private id: string;
    constructor(id: string) {
        this.id = id;
    }

    async echo(req: { msg: string }): Promise<{ echoed: string }> {
        return { echoed: `Echo: ${req.msg}${this.id}` };
    }

    async shout(req: { msg: string }): Promise<{ upper: string }> {
        return { upper: req.msg.toUpperCase() };
    }
}
```

---

#### 1. **Use Node.js workers**  
> Only valid in a Node.js environment (e.g., backend services, CLI tools)

- You must lift the pure worker class into an actual worker.  

    ```typescript
    // workers/echo/node/parent.ts
    import { WorkerParent } from '@nori-zk/workers/node/parent';
    import { type EchoWorker } from 'path/to/echo/worker';
    import { createProxy } from '@nori-zk/workers';

    const workerUrl = new URL('./child.js', import.meta.url);

    export const EchoWorkerParent = createProxy<typeof EchoWorker>(
        new WorkerParent(workerUrl)
    );
    ```

    ```typescript
    // workers/echo/node/child.ts
    import { EchoWorker } from 'path/to/echo/worker';
    import { WorkerChild } from '@nori-zk/workers/node/child';
    import { createWorker } from '@nori-zk/workers';

    createWorker(new WorkerChild(), EchoWorker);
    ```

    **Usage in a Node.js app:**

    ```typescript
    import { EchoWorkerParent } from './node/parent.js';

    async function main() {
        // Construct parent with arguments
        const echoWorker = new EchoWorkerParent('node-app');

        // Optional: wait for ready (all calls are buffered)
        await echoWorker.ready;

        // Call worker methods
        const echoed = await echoWorker.echo({ msg: 'hello' });
        console.log(echoed); // { echoed: 'Echo: hellonode-app' }

        const upper = await echoWorker.shout({ msg: 'hello' });
        console.log(upper); // { upper: 'HELLO' }

        // Clean up
        echoWorker.terminate();
    }

    main();
    ```

---

#### 2. **For browsers**  
> Use this if you're building your own worker pipeline for the browser.

- You must lift the pure worker class into an actual worker.  

    ```typescript
    // workers/echo/browser/parent.ts
    import { WorkerParent } from '@nori-zk/workers/browser/parent';
    import { type EchoWorker } from 'path/to/echo/worker';
    import { createProxy } from '@nori-zk/workers';

    const worker = new Worker(new URL('./child.js', import.meta.url), {
        type: 'module',
    });

    const workerParent = new WorkerParent(worker);

    export const EchoWorkerParent = createProxy<typeof EchoWorker>(workerParent);
    ```

    ```typescript
    // workers/echo/browser/child.ts
    import { EchoWorker } from 'path/to/echo/worker';
    import { WorkerChild } from '@nori-zk/workers/browser/child';
    import { createWorker } from '@nori-zk/workers';

    createWorker(new WorkerChild(), EchoWorker);
    ```

    **Usage in a browser app:**

    ```typescript
    import { EchoWorkerParent } from './browser/parent.js';

    async function runBrowser() {
        // Construct parent with arguments
        const echoWorker = new EchoWorkerParent('browser-app');

        // Optional: await ready
        await echoWorker.ready;

        // Calls are automatically buffered if the worker isn't ready yet
        const echoed = await echoWorker.echo({ msg: 'hi' });
        console.log(echoed); // { echoed: 'Echo: hibrowser-app' }

        const upper = await echoWorker.shout({ msg: 'hi' });
        console.log(upper); // { upper: 'HI' }

        // Terminate when done
        echoWorker.terminate();
    }

    runBrowser();
    ```

---

#### 3. **Buffering & `ready` behavior**

- Internally, the parent uses deferred promises:

    ```typescript
    async call<Res>(methodName: string, ...args: any[]): Promise<Res> {
        if (methodName === 'worker-construct') {
            // Wait for child to spawn
            await this.workerSpawnedDeferred.promise;
        } else {
            // Wait for worker readiness (optional)
            await this.workerReadyDeferred.promise;
        }
        // Forward call to worker
    }
    ```

- All method calls are **queued automatically** until the worker is ready.
- `await ready` is **optional**; you can call methods immediately after construction.
- Construction arguments depend on the worker class definition; only provide them if the constructor requires them.
