import { Bytes, Field, type ProvableType, Struct, UInt8 } from 'o1js';
import { type EthVerifier } from './ethVerifier.js';
import { type Tuple } from 'o1js/dist/node/lib/util/types.js';
import {
    type PrivateInput,
    type ZkProgram as ZkProgramFunc,
} from 'o1js/dist/node/lib/proof-system/zkprogram.js';
import {
    type ConversionOutput,
    type SP1ProofWithPublicValuesPlonkNoTee,
} from '@nori-zk/proof-conversion/build/src/index.min.js';
import { wordToBytes } from '@nori-zk/proof-conversion/min';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Constructor<T = unknown> = new (...args: any[]) => T;

export type ZkProgram<
    Config extends {
        publicInput?: ProvableType;
        publicOutput?: ProvableType;
        methods: {
            [I in string]: {
                privateInputs: Tuple<PrivateInput>;
                auxiliaryOutput?: ProvableType;
            };
        };
    },
> = ReturnType<typeof ZkProgramFunc<Config>>;

export type CompilableZkProgram = {
    compile: (options?: unknown) => Promise<{
        verificationKey: {
            data: string;
            hash: Field;
        };
    }>;
};

export interface CreateProofArgument {
    sp1PlonkProof: SP1ProofWithPublicValuesPlonkNoTee;
    conversionOutputProof: ConversionOutput;
}

export type EthVerifierComputeOutput = Awaited<
    ReturnType<typeof EthVerifier.compute>
>;

export type VerificationKey = {
    data: string;
    hash: Field;
};

export class Bytes32 extends Bytes(32) {
    static get zero() {
        return new this(new Array(32).fill(0).map(() => new UInt8(0)));
    }
}

export class Bytes20 extends Bytes(20) {
    static get zero() {
        return new this(new Array(20).fill(0).map(() => new UInt8(0)));
    }
    static fromHex(hex: string): Bytes20 {
        return super.fromHex(hex) as Bytes20;
    }
    toField(): Field {
        let result = new Field(0);
        for (let i = 0; i < 20; i++) {
            result = result.mul(256).add(this.bytes[i].value);
        }
        return result;
    }
}

export function bytes32FieldPairToBytes32(
    highByteField: Field,
    lowerBytesField: Field
) {
    // wordToBytes returns little-endian (LSB first), so reverse to restore big-endian order.
    const highByte = wordToBytes(highByteField, 1)[0];
    const lowerBytes = wordToBytes(lowerBytesField, 31).reverse();
    return Bytes32.from([highByte, ...lowerBytes]);
}

export class Bytes32FieldPair extends Struct({
    highByteField: Field,
    lowerBytesField: Field,
}) {
    static fromBytes32(bytes32: Bytes32) {
        // Convert the store hash's higher byte into a provable field.
        let storeHashHighByteField = new Field(0);
        storeHashHighByteField = storeHashHighByteField.add(
            bytes32.bytes[0].value
        );

        // Convert the store hash's lower 31 bytes into a provable field.
        let storeHashLowerBytesField = new Field(0);
        for (let i = 1; i < 32; i++) {
            storeHashLowerBytesField = storeHashLowerBytesField
                .mul(256)
                .add(bytes32.bytes[i].value);
        }

        return new this({
            highByteField: storeHashHighByteField,
            lowerBytesField: storeHashLowerBytesField,
        });
    }

    toBytes32(): Bytes32 {
        return bytes32FieldPairToBytes32(
            this.highByteField,
            this.lowerBytesField
        );
    }
}

