import path from 'path';
import { fileURLToPath } from 'url';
import { Field, SmartContract, UInt64, UInt8 } from 'o1js';
import { Logger, wordToBytes } from '@nori-zk/proof-conversion';
import { PlonkProof, Bytes32, ZkProgram, CompilableZkProgram } from './types.js';

export function uint8ArrayToBigIntBE(bytes: Uint8Array): bigint {
    return bytes.reduce((acc, byte) => (acc << 8n) + BigInt(byte), 0n);
}

export function uint8ArrayToBigIntLE(bytes: Uint8Array): bigint {
    return bytes.reduceRight((acc, byte) => (acc << 8n) + BigInt(byte), 0n);
}

export function fieldToHexBE(field: Field) {
    const bytesLE = wordToBytes(field, 32); // This is LE
    const bytesBE = bytesLE.reverse();
    return `0x${bytesBE.map((byte) => byte.toBigInt().toString(16).padStart(2, '0')).join('')}`
}

export function fieldToBigIntBE(field: Field) {
    const bytesLE = wordToBytes(field, 32); // This is LE
    const bytesBE = bytesLE.reverse();
    return bytesBE.reduce((acc, byte) => (acc << 8n) + byte.toBigInt(), 0n)
}

export function fieldToHexLE(field: Field) {
    const bytesLE = wordToBytes(field, 32); // This is LE
    return `0x${bytesLE.map((byte) => byte.toBigInt().toString(16).padStart(2, '0')).join('')}`
}

export function fieldToBigIntLE(field: Field) {
    const bytesLE = wordToBytes(field, 32); // This is LE
    return bytesLE.reduce((acc, byte) => (acc << 8n) + byte.toBigInt(), 0n)
}

// DEPRECATED
export function padUInt64To32Bytes(num: UInt64): UInt8[] {
    let unpadded: UInt8[] = [];
    unpadded = wordToBytes(num.toFields()[0]);
    return [...unpadded, ...Array(24).fill(UInt8.from(0))].reverse();
}

// This is explicitly here for validation puposes not supposed to be provable.
function toBigIntFromBytes(bytes: Uint8Array): bigint {
    let result = 0n;
    for (const byte of bytes) {
        result = (result << 8n) | BigInt(byte);
    }
    return result;
}

// This is explicitly here for validation puposes not supposed to be provable.
const MAX_U64 = (1n << 64n) - 1n;
function assertUint64(value: bigint): void {
    if (value < 0n || value > MAX_U64) {
        throw new RangeError(`Value out of range for u64: '${value}'.`);
    }
}

// Proof decoder

const proofOffsets = {
    inputSlot: 0,
    inputStoreHash: 8,
    outputSlot: 40,
    outputStoreHash: 48,
    executionStateRoot: 80,
    verifiedContractStorageSlotsRoot: 112,
    nextSyncCommitteeHash: 144,
};

const proofTotalLength = 176;

export function decodeConsensusMptProof(ethSP1Proof: PlonkProof) {
    const proofData = new Uint8Array(
        Buffer.from(ethSP1Proof.public_values.buffer.data)
    );

    if (proofData.length !== proofTotalLength) {
        throw new Error(
            `Byte slice must be exactly ${proofTotalLength} bytes, got '${proofData.length}'.`
        );
    }

    const inputSlotSlice = proofData.slice(
        proofOffsets.inputSlot,
        proofOffsets.inputStoreHash
    );
    const inputSlot = toBigIntFromBytes(inputSlotSlice);
    assertUint64(inputSlot);

    const inputStoreHashSlice = proofData.slice(
        proofOffsets.inputStoreHash,
        proofOffsets.outputSlot
    );

    const outputSlotSlice = proofData.slice(
        proofOffsets.outputSlot,
        proofOffsets.outputStoreHash
    );
    const outputSlot = toBigIntFromBytes(outputSlotSlice);
    assertUint64(outputSlot);

    const outputStoreHashSlice = proofData.slice(
        proofOffsets.outputStoreHash,
        proofOffsets.executionStateRoot
    );

    const executionStateRootSlice = proofData.slice(
        proofOffsets.executionStateRoot,
        proofOffsets.verifiedContractStorageSlotsRoot
    );

    const verifiedContractStorageSlotsRootSlice = proofData.slice(
        proofOffsets.verifiedContractStorageSlotsRoot,
        proofOffsets.nextSyncCommitteeHash
    );

    const nextSyncCommitteeHashSlice = proofData.slice(
        proofOffsets.nextSyncCommitteeHash,
        proofTotalLength
    );

    const provables = {
        inputSlot: UInt64.from(inputSlot),
        inputStoreHash: Bytes32.from(inputStoreHashSlice),
        outputSlot: UInt64.from(outputSlot),
        outputStoreHash: Bytes32.from(outputStoreHashSlice),
        executionStateRoot: Bytes32.from(executionStateRootSlice),
        verifiedContractDepositsRoot: Bytes32.from(
            verifiedContractStorageSlotsRootSlice
        ),
        nextSyncCommitteeHash: Bytes32.from(nextSyncCommitteeHashSlice),
    };

    return provables;
}

// Compile and verify contracts utility

export async function compileAndVerifyContracts(
    logger: Logger,
    contracts: {
        name: string;
        program: typeof SmartContract | CompilableZkProgram; // Ideally we would use CompilableZkProgram
        integrityHash: string;
    }[]
) {
    try {
        const results: Record<
            string,
            {
                data: string;
                hash: Field;
            }
        > = {};
        const mismatches: string[] = [];

        for (const { name, program, integrityHash } of contracts) {
            logger.log(`Compiling ${name} contract.`);
            const compiled = await program.compile();
            const verificationKey = compiled.verificationKey;
            const calculatedHash = verificationKey.hash.toString();

            logger.log(
                `${name} contract vk hash compiled: '${calculatedHash}'`
            );
            results[name] = verificationKey;

            if (calculatedHash !== integrityHash) {
                mismatches.push(
                    `${name}: Computed hash '${calculatedHash}' ` +
                        `doesn't match expected hash '${integrityHash}'`
                );
            }
        }

        if (mismatches.length > 0) {
            const errorMessage = [
                'Verification key hash mismatch detected:',
                ...mismatches,
                '',
                `Refusing to start. Try clearing your o1js cache directory, typically found at '~/.cache/o1js'. Or do you need to run 'npm run bake-vk-hashes' in the eth-processor or o1js-zk-utils nori-bridge-sdk folder and commit the change?`,
            ].join('\n');

            throw new Error(errorMessage);
        }

        logger.log('All contracts compiled and verified successfully.');
        return results;
    } catch (err) {
        logger.error(`Error compiling contracts:\n${String(err)}`);
        console.error((err as Error).stack);
        throw err;
    }
}

// Root dir

const __filename = fileURLToPath(import.meta.url);
export const rootDir = path.dirname(__filename);
