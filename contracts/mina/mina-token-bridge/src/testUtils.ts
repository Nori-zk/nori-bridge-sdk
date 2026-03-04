import { wordToBytes } from '@nori-zk/proof-conversion/min';
import { Bytes, Field, Mina, PrivateKey, PublicKey } from 'o1js';
import { Logger } from 'esm-iso-logger';

const logger = new Logger('NoriTokenBridgeTestUtils');

export function validateEnv(): {
    ethPrivateKey: string;
    ethRpcUrl: string;
    noriETHBridgeAddressHex: string;
    noriTokenBridgeAddressBase58: string;
    minaRpcUrl: string;
    minaSenderPrivateKeyBase58: string;
    noriTokenBaseAddressBase58: string;
} {
    const errors: string[] = [];

    const {
        ETH_PRIVATE_KEY,
        ETH_RPC_URL,
        NORI_ETH_TOKEN_BRIDGE_ADDRESS,
        NORI_MINA_TOKEN_BRIDGE_ADDRESS,
        MINA_RPC_NETWORK_URL,
        MINA_SENDER_PRIVATE_KEY,
        NORI_MINA_TOKEN_BASE_ADDRESS,
    } = process.env;

    if (!ETH_PRIVATE_KEY || !/^[a-fA-F0-9]{64}$/.test(ETH_PRIVATE_KEY)) {
        errors.push(
            'ETH_PRIVATE_KEY missing or invalid (expected 64 hex chars, no 0x prefix)'
        );
    }

    if (!ETH_RPC_URL || !/^https?:\/\//.test(ETH_RPC_URL)) {
        errors.push('ETH_RPC_URL missing or invalid (expected http(s) URL)');
    }

    if (
        !NORI_ETH_TOKEN_BRIDGE_ADDRESS ||
        !/^0x[a-fA-F0-9]{40}$/.test(NORI_ETH_TOKEN_BRIDGE_ADDRESS)
    ) {
        errors.push(
            'NORI_ETH_TOKEN_BRIDGE_ADDRESS missing or invalid (expected 0x-prefixed 40 hex chars)'
        );
    }

    if (
        !NORI_MINA_TOKEN_BRIDGE_ADDRESS ||
        !/^[1-9A-HJ-NP-Za-km-z]+$/.test(NORI_MINA_TOKEN_BRIDGE_ADDRESS)
    ) {
        errors.push(
            'NORI_MINA_TOKEN_BRIDGE_ADDRESS missing or invalid (expected Base58 string)'
        );
    }

    if (
        !NORI_MINA_TOKEN_BASE_ADDRESS ||
        !/^[1-9A-HJ-NP-Za-km-z]+$/.test(NORI_MINA_TOKEN_BASE_ADDRESS)
    ) {
        errors.push(
            'NORI_MINA_TOKEN_BASE_ADDRESS missing or invalid (expected Base58 string)'
        );
    }

    if (!MINA_RPC_NETWORK_URL || !/^https?:\/\//.test(MINA_RPC_NETWORK_URL)) {
        errors.push(
            'MINA_RPC_NETWORK_URL missing or invalid (expected http(s) URL)'
        );
    }

    if (
        !MINA_SENDER_PRIVATE_KEY ||
        !/^[1-9A-HJ-NP-Za-km-z]+$/.test(MINA_SENDER_PRIVATE_KEY)
    ) {
        errors.push(
            'MINA_SENDER_PRIVATE_KEY missing or invalid (expected Base58 string)'
        );
    }

    if (errors.length) {
        const errorMessage = 'Environment validation errors:\n' + errors.map((e) => ' - ' + e).join('\n');
        logger.fatal(errorMessage);
    }

    return {
        ethPrivateKey: ETH_PRIVATE_KEY,
        ethRpcUrl: ETH_RPC_URL,
        noriETHBridgeAddressHex: NORI_ETH_TOKEN_BRIDGE_ADDRESS,
        noriTokenBridgeAddressBase58: NORI_MINA_TOKEN_BRIDGE_ADDRESS,
        noriTokenBaseAddressBase58: NORI_MINA_TOKEN_BASE_ADDRESS,
        minaRpcUrl: MINA_RPC_NETWORK_URL,
        minaSenderPrivateKeyBase58: MINA_SENDER_PRIVATE_KEY,
    };
}

export async function getNewMinaLiteNetAccountSK(): Promise<string> {
    const rpcUrl = process?.env?.MINA_RPC_NETWORK_URL || 'http://localhost:8080/graphql';
    const url = new URL(rpcUrl);
    const host = url.hostname;

    const response = await fetch(`http://${host}:8181/acquire-account`);
    const data = await response.json();
    logger.log(`Received new sk from acquire account.`);
    return data.sk;
}

export async function getNewMinaLiteNetAccountKeyPair(): Promise<{sk: string, pk: string}> {
    const rpcUrl = process?.env?.MINA_RPC_NETWORK_URL || 'http://localhost:8080/graphql';
    const url = new URL(rpcUrl);
    const host = url.hostname;

    const response = await fetch(`http://${host}:8181/acquire-account`);
    const data = await response.json();
    logger.log(`Received new keyPair from acquire account.`);
    const {sk, pk} = data;
    return {sk, pk};
}

export function keyPairBase58ToKeyPair({ sk, pk }: { sk: string; pk: string }): { privateKey: PrivateKey; publicKey: PublicKey } {
    return {
        privateKey: PrivateKey.fromBase58(sk),
        publicKey: PublicKey.fromBase58(pk),
    };
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
    logger.log('attestationHex', attestationHex);
    const bytesFromHex = Bytes.fromHex(attestationHex); // this is be
    let fieldFromHex = new Field(0);
    for (let i = 0; i < 32; i++) {
        fieldFromHex = fieldFromHex.mul(256).add(bytesFromHex.bytes[i].value);
    }
    expect(fieldFromHex.toBigInt()).toEqual(attestationHash.toBigInt());
    logger.log(fieldFromHex.toBigInt(), attestationHash.toBigInt());

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
    logger.log('commandDetails', commandDetails);
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
    logger.log(`Lock output:\n${data}`);
    logger.log('----------------------');
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
    //logger.log(parsed);
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
