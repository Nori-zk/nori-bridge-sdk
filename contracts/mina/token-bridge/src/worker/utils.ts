export class InvertedPromise<T = void, E = void> {
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