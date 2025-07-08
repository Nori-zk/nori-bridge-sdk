import {
    Bytes,
    Field,
    Provable,
    ProvableType,
    Struct,
    UInt64,
    UInt8,
} from 'o1js';
import { EthVerifier } from './ethVerifier.js';
import { Tuple } from 'o1js/dist/node/lib/util/types.js';
import {
    PrivateInput,
    ZkProgram as ZkProgramFunc,
} from 'o1js/dist/node/lib/proof-system/zkprogram.js';

export type Constructor<T = any> = new (...args: any) => T;

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
    }
> = ReturnType<typeof ZkProgramFunc<Config>>;

export type CompilableZkProgram = {
    compile: (options?: any) => Promise<{
        verificationKey: {
            data: string;
            hash: Field;
        };
    }>;
};

export interface Proof {
    Plonk: {
        encoded_proof: string;
        plonk_vkey_hash: number[];
        public_inputs: string[];
        raw_proof: string;
    };
}

export interface PublicValues {
    buffer: {
        data: number[];
    };
}

export interface PlonkProof {
    proof: Proof;
    public_values: PublicValues;
    sp1_version: string;
}

export interface ConvertedProofProofData {
    maxProofsVerified: 0 | 1 | 2;
    proof: string;
    publicInput: string[];
    publicOutput: string[];
}

export interface ConvertedProofVkData {
    data: string;
    hash: string;
}

export interface ConvertedProof {
    vkData: ConvertedProofVkData;
    proofData: ConvertedProofProofData;
}

export interface CreateProofArgument {
    sp1PlonkProof: PlonkProof;
    conversionOutputProof: ConvertedProof;
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
        return new this(new Array(32).map(() => new UInt8(0)));
    }
}

export class Bytes20 extends Bytes(20) {
    static get zero() {
        return new this(new Array(20).map(() => new UInt8(0)));
    }
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
}

// Next version could do something like this:
// (we could then fit two state into the contract a->b to allow the client minting more time)
/*
// Extract and accumulate lower 31 bytes of each Bytes32 field
function extractHighAndLowerBytes(bytes32: Bytes32): {
  high: Field;
  low: Field;
} {
  const high = new Field(bytes32.bytes[0].value);
  let low = new Field(0);
  for (let i = 1; i < 32; i++) {
    low = low.mul(256).add(bytes32.bytes[i].value);
  }
  return { high, low };
}

// Extract 31 bytes from a Field using bit manipulation (little-endian)
// Probably better with a witness.
export function extractBytesFromField(packed: Field): UInt8[] {
  const bits = packed.toBits();
  const bytes: UInt8[] = [];

  for (let i = 0; i < 31; i++) {
    let value = new Field(0);
    for (let j = 7; j >= 0; j--) {
      value = value.mul(2);
      const bit = bits[i * 8 + j];
      value = Provable.if(bit, value.add(1), value);
    }
    bytes.push(UInt8.from(value));
  }

  return bytes;
}

// Reconstruct a Bytes32 from high byte + packed lower 31 bytes
function reconstructBytes32(highByte: UInt8, lowerBytesField: Field): Bytes32 {
  const lowerBytes = extractBytesFromField(lowerBytesField);
  const allBytes = [highByte, ...lowerBytes];
  return Bytes32.from(allBytes);
}

// Input Struct
export class EthProcessorMutateStateInputs extends Struct({
  storageHash: Bytes32,
  verifiedContractDepositsRoot: Bytes32,
  verifiedStateRoot: Bytes32,
}) {}

// Internal Mutable State Struct
export class EthProcessorMutableState extends Struct({
  storageHashLower: Field,
  verifiedDepositsCurrentRootLower: Field,
  verifiedCurrentStateRootLower: Field,
  contractMiscField: Field, // 3 high bytes packed: storageHigh, depositHigh, stateHigh
}) {
  static fromInputs(
    storageHash: Bytes32,
    verifiedContractDepositsCurrentRoot: Bytes32,
    verifiedCurrentStateRoot: Bytes32
  ) {
    const { high: storageHigh, low: storageHashLower } = extractHighAndLowerBytes(storageHash);
    const { high: depositHigh, low: verifiedDepositsCurrentRootLower } = extractHighAndLowerBytes(verifiedContractDepositsCurrentRoot);
    const { high: stateHigh, low: verifiedCurrentStateRootLower } = extractHighAndLowerBytes(verifiedCurrentStateRoot);

    // Pack high bytes: [storageHigh, depositHigh, stateHigh] -> into one Field
    let contractMiscField = new Field(0);
    contractMiscField = contractMiscField
      .add(stateHigh)           // LSB
      .mul(256)
      .add(depositHigh)
      .mul(256)
      .add(storageHigh);        // MSB

    return new this({
      storageHashLower,
      verifiedDepositsCurrentRootLower,
      verifiedCurrentStateRootLower,
      contractMiscField,
    });
  }

  toInputs(): EthProcessorMutateStateInputs {
    const miscBytes = extractBytesFromField(this.contractMiscField);

    // Unpack in same order as packed
    const stateHigh = miscBytes[0];
    const depositHigh = miscBytes[1];
    const storageHigh = miscBytes[2];

    const storageHash = reconstructBytes32(storageHigh, this.storageHashLower);
    const verifiedContractDepositsRoot = reconstructBytes32(depositHigh, this.verifiedDepositsCurrentRootLower);
    const verifiedStateRoot = reconstructBytes32(stateHigh, this.verifiedCurrentStateRootLower);

    return new EthProcessorMutateStateInputs({
      storageHash,
      verifiedContractDepositsRoot,
      verifiedStateRoot,
    });
  }
}
*/
