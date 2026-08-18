import { fieldToBytesLE } from '@nori-zk/o1js-zk-utils';
import { Bytes, CircuitString, fetchAccount, Field, Mina, PrivateKey, PublicKey, Signature, UInt64, UInt8 } from 'o1js';
import { Logger } from 'esm-iso-logger';
import {
    buildContractDepositSlotLeaves,
    VerifiedRequest,
    MerkleTreeContractDepositAttestorInput,
    MerklePath,
} from '../depositAttestation.js';
import {
    createCodeChallenge,
    SCRAMWitness,
} from '../scram.js';
import {
    Bytes20,
    Bytes32,
    computeMerkleTreeDepthAndSize,
    getMerklePathFromLeaves,
    getMerkleZeros,
} from '@nori-zk/o1js-zk-utils';

import { env, type NetworkName } from '../env.js';
import { NoriTokenBridge } from '../NoriTokenBridge.js';

const logger = new Logger('NoriTokenBridgeTestUtils');

const validNetworkNames: NetworkName[] = ['mina', 'zeko'];

export function getStagingEnv() {
    const chainName = process.env.TEST_MINA_STAGING_CHAIN_NAME ?? 'mina';
    if (!validNetworkNames.includes(chainName as NetworkName)) {
        throw new Error(
            `TEST_MINA_STAGING_CHAIN_NAME '${chainName}' is not a valid NetworkName. Expected one of: ${validNetworkNames.join(', ')}`
        );
    }
    const staging = env[chainName as NetworkName]?.staging;
    if (!staging) {
        throw new Error(
            `No staging env found for chain '${chainName}'`
        );
    }
    return staging;
}

export function validateEnv(): {
    ethPrivateKey: string;
    ethRpcUrl: string;
    minaSenderPrivateKeyBase58: string;
} {
    const errors: string[] = [];

    const {
        ETH_PRIVATE_KEY,
        ETH_RPC_URL,
        MINA_SENDER_PRIVATE_KEY,
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

export async function getNewMinaLiteNetAccountKeyPair(): Promise<{ sk: string, pk: string }> {
    const rpcUrl = process?.env?.MINA_RPC_NETWORK_URL || 'http://localhost:8080/graphql';
    const url = new URL(rpcUrl);
    const host = url.hostname;

    const response = await fetch(`http://${host}:8181/acquire-account`);
    const data = await response.json();
    logger.log(`Received new keyPair from acquire account.`);
    const { sk, pk } = data;
    return { sk, pk };
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

export async function lockTokens(codeChallenge: Field, amount: number) {
    // Lock guard
    expect(amount).toBeLessThan(0.001);

    // Ensure we can do the field -> hex -> field round trip
    const beBytes = Bytes.from(fieldToBytesLE(codeChallenge).reverse());
    const codeChallengeHex = beBytes.toHex();
    logger.log('codeChallengeHex', codeChallengeHex);
    const bytesFromHex = Bytes.fromHex(codeChallengeHex); // this is be
    let fieldFromHex = new Field(0);
    for (let i = 0; i < 32; i++) {
        fieldFromHex = fieldFromHex.mul(256).add(bytesFromHex.bytes[i].value);
    }
    expect(fieldFromHex.toBigInt()).toEqual(codeChallenge.toBigInt());
    logger.log(fieldFromHex.toBigInt(), codeChallenge.toBigInt());

    // Use the ethereum package to lock our tokens
    const { spawn } = await import('node:child_process');
    const { fileURLToPath } = await import('url');
    const { resolve, dirname } = await import('node:path');
    const __filename = fileURLToPath(import.meta.url);
    const rootDir = dirname(__filename);
    const commandDetails: [string, string[], { cwd: string }] = [
        'npm',
        ['run', 'test:lock', `0x${codeChallengeHex}`, amount.toString()],
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

// ---------------------------------------------------------------------------
// Shared test helpers
// ---------------------------------------------------------------------------

export async function txSend({
    body,
    sender,
    signers,
    fee: txFee = 1e8,
}: {
    body: () => Promise<void>;
    sender: PublicKey;
    signers: PrivateKey[];
    fee?: number;
}) {
    const tx = await Mina.transaction({ sender, fee: txFee }, body);
    await tx.prove();
    tx.sign(signers);
    const pendingTx = await tx.send();
    return pendingTx.wait();
}

export async function fetchAccounts(addrs: PublicKey[]) {
    await Promise.all(addrs.map((addr) => fetchAccount({ publicKey: addr })));
}

/**
 * Fixed Ethereum token bridge address for synthetic-deposit tests. Deploy the
 * bridge with it and build synthetic deposits against it so the noriMint
 * target assertion passes.
 */
export const TEST_ETH_TOKEN_BRIDGE_ADDRESS_HEX = '42'.repeat(20);

/**
 * Build a self-consistent synthetic deposit for noriMint() tests.
 * Signs a SCRAM message with the recipient's private key and builds
 * the deposit attestation from the resulting codeChallenge.
 */
export function buildSyntheticDeposit(
    recipientPrivateKey: PrivateKey,
    messageSCRAMStr: string,
    totalLockedBU: bigint = 2n,
    targetHex: string = TEST_ETH_TOKEN_BRIDGE_ADDRESS_HEX
): {
    merkleInput: MerkleTreeContractDepositAttestorInput;
    scramWitness: SCRAMWitness;
} {
    const msgCS = CircuitString.fromString(messageSCRAMStr);
    const msgFields = msgCS.values.map((char) => char.toField());
    const signature = Signature.create(recipientPrivateKey, msgFields);
    const codeChallenge = createCodeChallenge(signature);
    const codeChallengeHex = codeChallenge.toBigInt().toString(16).padStart(64, '0');
    const valueHex = totalLockedBU.toString(16).padStart(64, '0');

    const deposit = new VerifiedRequest({
        target: Bytes20.fromHex(targetHex.replace(/^0x/, '').padStart(40, '0')),
        collectionKeysCount: UInt8.from(1),
        collectionKeys: [
            Bytes32.fromHex(codeChallengeHex),
            Bytes32.fromHex('0'.repeat(64)),
        ],
        value: Bytes32.fromHex(valueHex),
    });

    const leaves = buildContractDepositSlotLeaves([deposit]);
    const { depth, paddedSize } = computeMerkleTreeDepthAndSize(leaves.length);
    const zeros = getMerkleZeros(depth);
    const path = getMerklePathFromLeaves([...leaves], paddedSize, depth, 0, zeros);

    const merklePath = MerklePath.from([]);
    path.forEach((p) => merklePath.push(p));

    const merkleInput = new MerkleTreeContractDepositAttestorInput({
        path: merklePath,
        index: UInt64.fromValue(0),
        value: deposit,
    });

    const scramWitness = new SCRAMWitness({
        signature,
        message: msgFields,
    });

    return { merkleInput, scramWitness };
}

/** Read the current on-chain windowStart to pass as the noriMint witness. */
export async function fetchWindowStartWitness(bridge: NoriTokenBridge): Promise<Field> {
    const ws = await bridge.windowStart.fetch();
    if (ws === undefined) throw new Error('could not fetch windowStart');
    return ws;
}