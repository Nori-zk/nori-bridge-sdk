import { wordToBytes } from '@nori-zk/proof-conversion/min';
import { Bytes, Field, Mina } from 'o1js';

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
                        console.log(`Received new sk from acquire account.`);
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

export async function lockTokens(attestationHash: Field, amount: number) {
    // Lock guard
    expect(amount).toBeLessThan(0.001);

    // Ensure we can do the field -> hex -> field round trip
    const beBytes = Bytes.from(wordToBytes(attestationHash, 32).reverse());
    const attestationHex = beBytes.toHex();
    console.log('attestationHex', attestationHex);
    const bytesFromHex = Bytes.fromHex(attestationHex); // this is be
    let fieldFromHex = new Field(0);
    for (let i = 0; i < 32; i++) {
        fieldFromHex = fieldFromHex.mul(256).add(bytesFromHex.bytes[i].value);
    }
    expect(fieldFromHex.toBigInt()).toEqual(attestationHash.toBigInt());
    console.log(fieldFromHex.toBigInt(), attestationHash.toBigInt());

    // Use the ethereum package to lock our tokens
    const { spawn } = await import('node:child_process');
    const { fileURLToPath } = await import('url');
    const { resolve, dirname } = await import('node:path');
    const __filename = fileURLToPath(import.meta.url);
    const rootDir = dirname(__filename);
    const commandDetails: [string, string[], { cwd: string }] = [
        'npm',
        ['run', 'test:lock', `0x${attestationHex}`, amount.toString()],
        { cwd: resolve(rootDir, '..', '..', '..', 'ethereum') },
    ];
    console.log('commandDetails', commandDetails);
    const [command, args, options] = commandDetails;
    const child = spawn(command, args, options);
    let data = '';
    let error = '';
    for await (let chunk of child.stdout) {
        data += chunk;
    }
    for await (let chunk of child.stderr) {
        error += chunk;
    }
    await new Promise((resolve, reject) =>
        child.on('close', (code) => {
            if (code)
                return reject(
                    new Error(`Process exited non zero code ${code}\n${error}`)
                );
            resolve(code);
        })
    );
    console.log(`Lock output:\n${data}`);
    console.log('----------------------');
    const match = data.match(/Transaction included in block number: (\d+)/);
    if (!match) return null;
    return parseInt(match[1]);
}

export async function getEthereumEnvPrivateKey() {
    const { fileURLToPath } = await import('url');
    const { resolve, dirname } = await import('node:path');
    const __filename = fileURLToPath(import.meta.url);
    const rootDir = dirname(__filename);

    const fs = await import('fs');
    const dotenv = await import('dotenv');

    const envBuffer = fs.readFileSync(
        resolve(rootDir, '..', '..', '..', 'ethereum', '.env')
    );
    const parsed = dotenv.parse(envBuffer);
    //console.log(parsed);
    return parsed.ETH_PRIVATE_KEY as string;
}

export async function getEthWallet() {
    const privateKey = await getEthereumEnvPrivateKey();
    const { ethers } = await import('ethers');
    return new ethers.Wallet(privateKey);
}

export async function minaSetup() {
    const Network = Mina.Network({
        networkId: 'devnet',
        mina: 'http://localhost:8080/graphql',
    });
    Mina.setActiveInstance(Network);
}
