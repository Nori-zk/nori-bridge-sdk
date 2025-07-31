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
     * @param args - The message arguments.
     */
    send(...args: any[]): void;

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
     * @param args - The message arguments.
     */
    call(...args: any[]): void;

    /**
     * Terminates the child endpoint.
     */
    terminate: () => void;

    /**
     * Worker is ready
     */
    ready: () => Promise<void>;
}

/**
 * Extracts keys of methods that return a Promise from type T.
 */
type MethodNames<T> = {
    [K in keyof T]: T[K] extends (...args: any) => Promise<any> ? K : never;
}[keyof T];

/**
 * Creates a proxy type from T containing only async methods.
 */
export type WorkerChildInfer<T> = {
    [K in MethodNames<T>]: T[K] extends (
        ...args: infer Args
    ) => Promise<infer Res>
        ? (...args: Args) => Promise<Res>
        : never;
};

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
    #child: WorkerParentChildInterface;
    #pendingRequests = new Map<number, DeferredPromise<any, any>>();
    #requestId = 0;

    /**
     * Constructs the WorkerParentBase and attaches communication handlers.
     * @param child - The child endpoint to communicate with.
     */
    constructor(child: WorkerParentChildInterface) {
        this.#child = child;
        this.#child.onMessageHandler(this.#onMessage.bind(this));
        this.#child.onErrorHandler(this.#onError.bind(this));
    }

    /**
     * Sends a request to the child with a method name and arguments, and returns a promise for the response.
     *
     * @param methodName - The name of the method to invoke on the child.
     * @param args - Arguments to pass to the child method.
     * @returns A promise that resolves with the result of the child method call.
     */
    async call<Res>(methodName: string, ...args: any[]): Promise<Res> {
        // Await child readyness
        await this.#child.ready();

        // Generate a unique ID for this request
        const id = ++this.#requestId;

        // Construct the message to send to the child
        const message = { id, methodName, args };

        // Serialise the message into a JSON string
        const messageStr = JSON.stringify(message);

        // Create a deferred promise to be resolved/rejected upon response
        const deferred = new DeferredPromise<Res, Error>();

        // Track the pending request using its ID
        this.#pendingRequests.set(id, deferred);

        // Send the serialized message to the child
        this.#child.call(messageStr);

        // Return the promise to the caller
        return deferred.promise;
    }

    /**
     * Handles a response message from the child.
     * Parses the message, finds the corresponding deferred promise, and resolves or rejects it.
     *
     * @param messageStr - JSON string containing the response.
     */
    #onMessage(messageStr: string) {
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
        const { id, data, error } = response;

        // Retrieve the pending promise associated with the message ID
        const deferred = this.#pendingRequests.get(id);
        if (!deferred) return;

        // Reject the promise if there was an error in the response
        if (error) deferred.reject(new Error(error));
        // Otherwise, resolve the promise with the response data
        else deferred.resolve(data);

        // Clean up by removing the resolved/rejected promise from the map
        this.#pendingRequests.delete(id);
    }

    /**
     * Rejects all in-flight promises on error.
     * @param error - The error to reject with.
     */
    #onError(error: any) {
        this.#pendingRequests.forEach((deferred) => deferred.reject(error));
        this.#pendingRequests.clear();
    }

    /**
     * Terminates the child endpoint.
     */
    terminate() {
        this.#child.terminate();
    }
}

/**
 * Child-side base handler for responding to messages from the parent.
 */
export class WorkerChildBase {
    #pendingRequests = new Map<number, DeferredPromise<any, any>>();
    #parent: WorkerChildParentInterface;

    /**
     * Constructs the WorkerChildBase and attaches communication handlers.
     * @param parent - The parent endpoint to respond to.
     */
    constructor(parent: WorkerChildParentInterface) {
        this.#parent = parent;
        this.#parent.onMessageHandler(this.#onMessage.bind(this));
        this.#parent.onErrorHandler(this.#onError.bind(this));
    }

    /**
     * Handles a message received from the parent.
     * @param messageStr - JSON string message.
     */
    async #onMessage(messageStr: string) {
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
        if (this.#pendingRequests.has(message.id)) {
            const deferred = this.#pendingRequests.get(message.id)!;
            if (message.error) deferred.reject(new Error(message.error));
            else deferred.resolve(message.data);
            this.#pendingRequests.delete(message.id);
            return;
        }

        const { id, methodName, args = [] } = message;

        // Reject if the method doesn't exist
        if (typeof (this as any)[methodName] !== 'function') {
            this.#sendError(id, methodName, `Method '${methodName}' not found`);
            return;
        }

        try {
            // Call the method and send back the result
            const result = await (this as any)[methodName](...args);
            this.#sendResponse(id, methodName, result);
        } catch (error: any) {
            console.error(error);
            this.#sendError(id, methodName, error?.message ?? String(error));
        }
    }

    /**
     * Sends a success response to the parent.
     * @param id - Request ID.
     * @param methodName - Name of the method.
     * @param data - Result data to send.
     */
    #sendResponse(id: number, methodName: string, data: any) {
        const response = { id, methodName, data };
        this.#parent.send(JSON.stringify(response));
    }

    /**
     * Sends an error response to the parent.
     * @param id - Request ID.
     * @param methodName - Name of the method.
     * @param error - Error message.
     */
    #sendError(id: number, methodName: string, error: string) {
        const response = { id, methodName, error };
        this.#parent.send(JSON.stringify(response));
    }

    /**
     * Rejects all in-flight promises on error.
     * @param error - The error to reject with.
     */
    #onError(error: any) {
        this.#pendingRequests.forEach((deferred) => deferred.reject(error));
        this.#pendingRequests.clear();
    }
}

/**
 * Binds worker logic implementation to a communication channel as a child.
 *
 * @param parent - The parent communication endpoint
 * @param ChildClass - The class defining worker logic
 * @param args - Arguments passed to the worker logic constructor
 * @returns An object with a terminate method
 */
export function createWorker<T>(
    parent: WorkerChildParentInterface,
    ChildClass: new (...args: any[]) => T,
    ...args: any[]
) {
    // Instantiate the actual worker logic
    const workerLogic = new ChildClass(...args);

    // Create the child base to handle communication
    const childBase = new WorkerChildBase(parent);

    // Get all methods from the worker logic
    const proto = Object.getPrototypeOf(workerLogic);

    // Bind all methods to the child base for handling incoming requests
    for (const key of Object.getOwnPropertyNames(proto)) {
        if (key === 'constructor') continue;
        if (typeof proto[key] !== 'function') continue;

        // Bind the actual method to the child base
        (childBase as any)[key] = (...args: any[]) =>
            (workerLogic as any)[key](...args);
    }

    // Return terminate
    return { terminate: () => parent.terminate() };
}

/**
 * Creates a proxy for the parent to invoke child logic via async calls.
 *
 * @param child - The child endpoint
 * @param ChildClass - The class defining the child’s logic
 * @param args - Arguments passed to the logic class constructor
 * @returns A proxy object with async methods and a terminate method
 */
export function createParent<T>(
    child: WorkerParentChildInterface,
    ChildClass: new (...args: any[]) => T,
    ...args: any[]
) {
    // Create parent base to handle communication
    const parentBase = new WorkerParentBase(child);

    // Get method names from the target class
    const temp = new ChildClass(...args);
    const proto = Object.getPrototypeOf(temp);

    // Create a proxy
    const proxyInstance: Record<string, any> = {};

    for (const key of Object.getOwnPropertyNames(proto)) {
        if (key === 'constructor') continue;
        if (typeof proto[key] !== 'function') continue;

        // For each method of the child, emit a message which calls the worker.
        proxyInstance[key] = (...args: any[]) => parentBase.call(key, ...args);
    }

    // Extend the proxy with terminate.
    proxyInstance.terminate = () => parentBase.terminate();

    // Return the proxy
    return proxyInstance as WorkerChildInfer<T> & { terminate(): void };
}
