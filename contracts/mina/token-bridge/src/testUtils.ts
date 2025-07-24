export async function getNewMinaLiteNetAccountSK(): Promise<string> {
    const { request } = await import('http');
    return new Promise((resolve, reject) => {
        const req = request(
            {
                host: 'localhost',
                port: 8181,
                path: '/acquire-account',
                method: 'GET',
            },
            (res) => {
                res.setEncoding('utf8');
                let buffer = '';
                res.on('data', (data) => (buffer += data));
                res.on('end', () => {
                    try {
                        const data = JSON.parse(buffer);
                        console.log(
                            `Received new sk from acquire account.`
                        );
                        resolve(data.sk);
                    } catch (e) {
                        const error = e as unknown as Error;
                        console.error(
                            `Failed to retreive a new account:\n${String(
                                error.stack
                            )}`
                        );
                        reject(error);
                    }
                });
            }
        );
        req.on('error', (err) => reject(err));
        req.end();
    });
}

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

export function hexStringToUint8Array(hex: string): Uint8Array {
    if (hex.startsWith('0x')) hex = hex.slice(2);
    if (hex.length % 2 !== 0) hex = '0' + hex; // pad to full bytes
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
    }
    return bytes;
}