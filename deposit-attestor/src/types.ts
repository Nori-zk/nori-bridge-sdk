import { Bytes, UInt8 } from "o1js";

export type Constructor<T = any> = new (...args: any) => T;

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