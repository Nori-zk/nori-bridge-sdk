import { InvertedPromise } from '../utils.js';

export interface WorkerParentLike {
    send(data: string): void;
    onMessageHandler(callback: (response: string) => void): void;
    onErrorHandler(callback: (error: any) => void): void;
    terminate(): void;
}

type MethodNames<T> = {
    [K in keyof T]: T[K] extends (...args: any) => Promise<any> ? K : never;
}[keyof T];

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

    // Child calling parent method
    protected call<Req, Res>(methodName: string, data: Req): Promise<Res> {
        const id = ++this.#requestId;
        const message = { id, methodName, data };
        const messageStr = JSON.stringify(message);

        const deferred = new InvertedPromise<Res, Error>();
        this.#pendingRequests.set(id, deferred);
        this.#parent.send(messageStr);

        return deferred.promise;
    }

    // Internal raw message handler
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
            // Malformed message ignored or optionally send error back?
            return;
        }

        // If this is a response to a call initiated by child
        if (this.#pendingRequests.has(message.id)) {
            const deferred = this.#pendingRequests.get(message.id)!;
            if (message.error) deferred.reject(new Error(message.error));
            else deferred.resolve(message.data);
            this.#pendingRequests.delete(message.id);
            return;
        }

        // Otherwise this is a request from parent — dispatch to concrete method
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

/*export class EchoWorkerChild
    extends WorkerChildBase
    implements WorkerChildInfer<EchoWorkerChild>
{
    async echo(req: { msg: string }): Promise<{ echoed: string }> {
        return { echoed: `Echo: ${req.msg}` };
    }

    async shout(req: { msg: string }): Promise<{ upper: string }> {
        return { upper: req.msg.toUpperCase() };
    }
}*/
