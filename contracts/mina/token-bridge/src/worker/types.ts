import { InvertedPromise } from './utils.js';

export interface BaseWorkerEndpoint {
    onMessageHandler(callback: (response: string) => void): void;
    onErrorHandler(callback: (error: any) => void): void;
    terminate(): void;
}

export interface WorkerParentLike extends BaseWorkerEndpoint {
    send(data: string): void;
}

export interface WorkerChildLike extends BaseWorkerEndpoint {
    call(data: string): void;
}

type MethodNames<T> = {
    [K in keyof T]: T[K] extends (...args: any) => Promise<any> ? K : never;
}[keyof T];

export abstract class WorkerParentBase {
    #child: WorkerChildLike;
    #pendingRequests = new Map<number, InvertedPromise<any, any>>();
    #requestId = 0;

    constructor(child: WorkerChildLike) {
        this.#child = child;
        this.#child.onMessageHandler(this.#onMessage.bind(this));
        this.#child.onErrorHandler(this.#onError.bind(this));
    }

    protected call<Req, Res>(methodName: string, data: Req): Promise<Res> {
        const id = ++this.#requestId;
        const message = { id, methodName, data };
        const messageStr = JSON.stringify(message);

        const deferred = new InvertedPromise<Res, Error>();
        this.#pendingRequests.set(id, deferred);
        this.#child.call(messageStr);

        return deferred.promise;
    }

    #onMessage(messageStr: string) {
        let response: {
            id: number;
            methodName: string;
            data?: any;
            error?: string;
        };
        try {
            response = JSON.parse(messageStr);
        } catch {
            return;
        }

        const { id, data, error } = response;
        const deferred = this.#pendingRequests.get(id);
        if (!deferred) return;

        if (error) deferred.reject(new Error(error));
        else deferred.resolve(data);

        this.#pendingRequests.delete(id);
    }

    #onError(error: any) {
        this.#pendingRequests.forEach((deferred) => deferred.reject(error));
        this.#pendingRequests.clear();
    }

    terminate() {
        this.#child.terminate();
    }
}

export type WorkerChildInfer<T> = {
    [K in MethodNames<T>]: T[K] extends (req: infer Req) => Promise<infer Res>
        ? (req: Req) => Promise<Res>
        : never;
};

export abstract class WorkerChildBase {
    #pendingRequests = new Map<number, InvertedPromise<any, any>>();
    #requestId = 0;
    #parent: WorkerParentLike;

    constructor(parent: WorkerParentLike) {
        this.#parent = parent;
        this.#parent.onMessageHandler(this.#onRawMessage.bind(this));
        this.#parent.onErrorHandler(this.#onError.bind(this));
    }

    protected call<Req, Res>(methodName: string, data: Req): Promise<Res> {
        const id = ++this.#requestId;
        const message = { id, methodName, data };
        const messageStr = JSON.stringify(message);

        const deferred = new InvertedPromise<Res, Error>();
        this.#pendingRequests.set(id, deferred);
        this.#parent.send(messageStr);

        return deferred.promise;
    }

    async #onRawMessage(messageStr: string) {
        let message: {
            id: number;
            methodName: string;
            data?: any;
            error?: string;
        };

        try {
            message = JSON.parse(messageStr);
        } catch {
            return;
        }

        if (this.#pendingRequests.has(message.id)) {
            const deferred = this.#pendingRequests.get(message.id)!;
            if (message.error) deferred.reject(new Error(message.error));
            else deferred.resolve(message.data);
            this.#pendingRequests.delete(message.id);
            return;
        }

        await this.#handleRequest(message);
    }

    async #handleRequest(message: {
        id: number;
        methodName: string;
        data?: any;
    }) {
        const { id, methodName, data } = message;

        if (typeof (this as any)[methodName] !== 'function') {
            this.#sendError(id, methodName, `Method '${methodName}' not found`);
            return;
        }

        try {
            const result = await (this as any)[methodName](data);
            this.#sendResponse(id, methodName, result);
        } catch (error: any) {
            this.#sendError(id, methodName, error?.message ?? String(error));
        }
    }

    #sendResponse(id: number, methodName: string, data: any) {
        const response = { id, methodName, data };
        this.#parent.send(JSON.stringify(response));
    }

    #sendError(id: number, methodName: string, error: string) {
        const response = { id, methodName, error };
        this.#parent.send(JSON.stringify(response));
    }

    #onError(error: any) {
        this.#pendingRequests.forEach((deferred) => deferred.reject(error));
        this.#pendingRequests.clear();
    }
}
