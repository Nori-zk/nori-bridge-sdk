/**
 * Base interface for a communication endpoint between a parent and a worker.
 */
export interface BaseWorkerEndpoint {
    /**
     * Registers a handler for incoming messages.
     * @param callback - Callback to invoke with the received message.
     */
    onMessageHandler(callback: (response: string) => void): void;

    /**
     * Registers a handler for error events.
     * @param callback - Callback to invoke with the error.
     */
    onErrorHandler(callback: (error: any) => void): void;

    /**
     * Terminates the communication channel.
     */
    terminate(): void;
}

/**
 * Interface representing the parent side of the worker communication.
 */
export interface WorkerChildParentInterface extends BaseWorkerEndpoint {
    /**
     * Sends a message to the child.
     * @param data - The message string.
     */
    send(data: string): void;

    /**
     * Terminates the child worker.
     */
    terminate: () => void;
}

/**
 * Interface representing the child side of the worker communication.
 */
export interface WorkerParentChildInterface extends BaseWorkerEndpoint {
    /**
     * Sends a message to the parent.
     * @param data - The message string.
     */
    send(data: string): Promise<void>;

    /**
     * Terminates the child endpoint.
     */
    terminate: () => void;
}

/**
 * A deferred promise pattern with externally accessible resolve and reject.
 */
export class DeferredPromise<T = void, E = void> {
    resolve: (output: T) => void;
    reject: (error: E) => void;
    promise: Promise<T>;

    constructor() {
        this.promise = new Promise((resolve, reject) => {
            this.resolve = resolve;
            this.reject = reject;
        });
    }
}

/**
 * Parent-side base handler for managing requests sent to the child.
 */
export class WorkerParentBase {
    child: WorkerParentChildInterface;
    pendingRequests = new Map<number, DeferredPromise<any, any>>();
    workerSpawnedDeferred = new DeferredPromise();
    workerReadyDeferred = new DeferredPromise<void, Error>();
    requestId = 0;

    /**
     * Constructs the WorkerParentBase and attaches communication handlers.
     * @param child - The child endpoint to communicate with.
     */
    constructor(child: WorkerParentChildInterface) {
        this.child = child;
        this.child.onMessageHandler(this.onMessage.bind(this));
        this.child.onErrorHandler(this.onError.bind(this));
    }

    async spawned() {
        return this.workerSpawnedDeferred.promise;
    }

    async ready() {
        return this.workerReadyDeferred.promise;
    }

    __resolve_ready() {
        this.workerReadyDeferred.resolve();
    }

    __reject_ready(reason: string) {
        this.workerReadyDeferred.reject(new Error(reason));
    }

    /**
     * Sends a request to the child and returns a promise for the response.
     *
     * Calls are **buffered** based on worker state:
     * 1. If `methodName` is `'worker-construct'`, the call will wait until the worker
     *    has been spawned (`workerSpawnedDeferred` resolves).
     * 2. For all other methods, the call will wait until the worker is fully ready
     *    (`workerReadyDeferred` resolves).
     *
     * After the appropriate readiness check, a unique request ID is assigned, and
     * the request is sent to the child. The returned promise resolves or rejects
     * once the child responds or encounters an error.
     *
     * @param methodName - The name of the method to invoke on the child.
     * @param args - Arguments to pass to the child method.
     * @returns A promise that resolves with the result of the child method call.
     */
    async call<Res>(methodName: string, ...args: any[]): Promise<Res> {
        if (methodName === 'worker-construct') {
            // Await child init
            await this.workerSpawnedDeferred.promise;
        } else {
            // Await child readyness
            await this.workerReadyDeferred.promise;
        }

        //await this.#child.workerSpawned();

        // Generate a unique ID for this request
        const id = ++this.requestId;

        // Construct the message to send to the child
        const message = { id, methodName, args };

        // Serialise the message into a JSON string
        const messageStr = JSON.stringify(message);

        // Create a deferred promise to be resolved/rejected upon response
        const deferred = new DeferredPromise<Res, Error>();

        // Track the pending request using its ID
        this.pendingRequests.set(id, deferred);

        // Send the serialized message to the child
        await this.child.send(messageStr);

        // Return the promise to the caller
        return deferred.promise;
    }

    /**
     * Handles a response message from the child.
     * Parses the message, finds the corresponding deferred promise, and resolves or rejects it.
     *
     * @param messageStr - JSON string containing the response.
     */
    onMessage(messageStr: string) {
        // Attempt to parse the JSON response string
        let response: {
            id: number;
            methodName: string;
            data?: any;
            error?: string;
        };

        try {
            response = JSON.parse(messageStr);
        } catch {
            // If message is not valid JSON, silently ignore it
            return;
        }

        // Extract relevant data from the parsed message
        const { id, data, methodName, error } = response;

        if (methodName === 'worker-init') {
            // Special case for worker init
            this.workerSpawnedDeferred.resolve();
            return;
        }

        // Retrieve the pending promise associated with the message ID
        const deferred = this.pendingRequests.get(id);
        if (!deferred) return;

        // Reject the promise if there was an error in the response
        if (error) deferred.reject(new Error(error));
        // Otherwise, resolve the promise with the response data
        else deferred.resolve(data);

        // Clean up by removing the resolved/rejected promise from the map
        this.pendingRequests.delete(id);
    }

    /**
     * Rejects all in-flight promises on error.
     * @param error - The error to reject with.
     */
    onError(error: any) {
        this.pendingRequests.forEach((deferred) => deferred.reject(error));
        this.pendingRequests.clear();
    }

    /**
     * Terminates the child endpoint.
     */
    terminate() {
        this.child.terminate();
    }
}

/**
 * Child-side base handler for responding to messages from the parent.
 */
export class WorkerChildBase {
    pendingRequests = new Map<number, DeferredPromise<any, any>>();
    parent: WorkerChildParentInterface;
    workerInstance: any = null;
    ChildClass: new (...args: any[]) => any;

    /**
     * Constructs the WorkerChildBase and attaches communication handlers.
     * @param parent - The parent endpoint to respond to.
     */
    constructor(
        parent: WorkerChildParentInterface,
        ChildClass: new (...args: any[]) => any
    ) {
        this.parent = parent;
        this.parent.onMessageHandler(this.onMessage.bind(this));
        this.parent.onErrorHandler(this.onError.bind(this));
        const startedResponse = { id: -1, methodName: 'worker-init', data: '' };
        this.parent.send(JSON.stringify(startedResponse));
        this.ChildClass = ChildClass;
    }

    /**
     * Handles a message received from the parent.
     * @param messageStr - JSON string message.
     */
    async onMessage(messageStr: string) {
        let message: {
            id: number;
            methodName: string;
            args?: any[];
            data?: any;
            error?: string;
        };

        // Parse the message or return if invalid.
        try {
            message = JSON.parse(messageStr);
        } catch {
            return;
        }

        // Handle a response to a previous call
        if (this.pendingRequests.has(message.id)) {
            const deferred = this.pendingRequests.get(message.id)!;
            if (message.error) deferred.reject(new Error(message.error));
            else deferred.resolve(message.data);
            this.pendingRequests.delete(message.id);
            return;
        }

        const { id, methodName, args = [] } = message;

        // Lazy construction on "worker-construct"
        if (methodName === 'worker-construct') {
            try {
                this.workerInstance = new this.ChildClass(...args);
                this.sendResponse(id, methodName, null);
            } catch (err: any) {
                this.sendError(id, methodName, err?.message ?? String(err));
            }
            return;
        }

        // Ensure the instance exists
        if (!this.workerInstance) {
            this.sendError(id, methodName, 'Worker not constructed yet');
            return;
        }

        // Dispatch method calls to the worker instance
        const fn = this.workerInstance[methodName];
        if (typeof fn !== 'function') {
            this.sendError(id, methodName, `Method '${methodName}' not found`);
            return;
        }

        try {
            const result = await fn.apply(this.workerInstance, args);
            this.sendResponse(id, methodName, result);
        } catch (err: any) {
            this.sendError(id, methodName, err?.message ?? String(err));
        }
    }

    /**
     * Sends a success response to the parent.
     * @param id - Request ID.
     * @param methodName - Name of the method.
     * @param data - Result data to send.
     */
    sendResponse(id: number, methodName: string, data: any) {
        const response = { id, methodName, data };
        this.parent.send(JSON.stringify(response));
    }

    /**
     * Sends an error response to the parent.
     * @param id - Request ID.
     * @param methodName - Name of the method.
     * @param error - Error message.
     */
    sendError(id: number, methodName: string, error: string) {
        const response = { id, methodName, error };
        this.parent.send(JSON.stringify(response));
    }

    /**
     * Rejects all in-flight promises on error.
     * @param error - The error to reject with.
     */
    onError(error: any) {
        this.pendingRequests.forEach((deferred) => deferred.reject(error));
        this.pendingRequests.clear();
    }
}

/**
 * Binds a worker logic class to a child communication endpoint.
 *
 * This sets up a WorkerChildBase for handling messages from the parent and
 * dispatching them to the provided `ChildClass`.
 *
 * @param parent - The child endpoint to communicate with (implements WorkerChildParentInterface)
 * @param ChildClass - The class implementing the worker logic
 * @returns An object containing:
 *  - `terminate()`: Terminates the communication with the parent
 *  - `childBaseRef`: Reference to the underlying WorkerChildBase instance
 */
export function createWorker<T>(
    parent: WorkerChildParentInterface,
    ChildClass: new (...args: any[]) => T
) {
    const childBase = new WorkerChildBase(parent, ChildClass);
    return { terminate: () => parent.terminate(), childBaseRef: childBase };
}

/**
 * Creates a proxy for a worker on the parent side.
 *
 * The returned class mimics the worker's API and forwards calls through the worker
 * communication channel. Method calls return promises that resolve with the worker's response.
 *
 * **Buffering behavior:**  
 * - The constructor first sends a `'worker-construct'` request to spawn the worker.  
 * - All other method calls are automatically **queued until the worker is ready** (`ready` promise resolves).  
 *   This ensures that calls can be made immediately after construction, without manually waiting for the worker.
 *
 * @param child - The parent-side endpoint connected to the child (implements WorkerParentChildInterface)
 * @returns A class constructor. Instances of this class have:
 *  - Methods of the original worker class, returning Promises
 *  - `terminate()`: Terminates the worker
 *  - `ready`: Promise that resolves when the worker has been constructed and is ready
 */
export function createProxy<T extends new (...args: any) => any>(
    child: WorkerParentChildInterface
) {
    const parentBase = new WorkerParentBase(child);

    type ConstructorArgs = ConstructorParameters<T>;

    return class ProxyClass {
        constructor(...args: ConstructorArgs) {
            // Send the construction method
            const ready = parentBase
                .spawned()
                .then(() => {
                    // send the construct with the args
                    return parentBase.call('worker-construct', ...args);
                })
                .then(() => parentBase.__resolve_ready())
                .catch((e) => {
                    // see if e is an error and convert as needed
                    let error: Error;
                    if (e instanceof Error) {
                        error = e;
                    } else {
                        error = new Error(e);
                    }
                    parentBase.__reject_ready(error.message);
                    throw e;
                });
            return new Proxy(this, {
                get(target, propName) {
                    if (typeof propName !== 'string') {
                        throw new Error(
                            'Only string method names are supported'
                        );
                    }
                    if (propName === 'terminate')
                        return parentBase.terminate.bind(parentBase);
                    if (propName === 'ready') return ready;
                    return async (...args: any[]) =>
                        parentBase.call(propName, ...args);
                },
            }) as InstanceType<T> & {
                terminate(): void;
                ready: Promise<void>;
            };
        }
    } as {
        new (...args: ConstructorArgs): InstanceType<T> & {
            terminate(): void;
            ready: Promise<void>;
        };
    };
}
