import { InvertedPromise } from "../utils.js";

export interface WorkerChildLike {
  call(data: string): void;
  onMessageHandler(callback: (response: string) => void): void;
  onErrorHandler(callback: (error: any) => void): void;
  terminate: () => void;
}

type MethodNames<T> = {
  [K in keyof T]: T[K] extends (...args: any) => Promise<any> ? K : never;
}[keyof T];


type WorkerApiInfer<T> = {
  [K in MethodNames<T>]: T[K] extends (req: infer Req) => Promise<infer Res>
    ? (req: Req) => Promise<Res>
    : never;
};

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
    let response: { id: number; methodName: string; data?: any; error?: string };
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

export class EchoWorkerApi extends WorkerParentBase implements WorkerApiInfer<EchoWorkerApi> {
  echo(req: { msg: string }): Promise<{ echoed: string }> {
    return this.call("echo", req);
  }

  shout(req: { msg: string }): Promise<{ upper: string }> {
    return this.call("shout", req);
  }
}

// Usage example:
// const worker: WorkerLike = ...;
/*const api = new EchoWorkerApi({} as unknown as WorkerChildLike);
const a = await api.echo({ msg: "hello" });
a.echoed
const b = await api.shout({ msg: "hello" });
b.upper
*/