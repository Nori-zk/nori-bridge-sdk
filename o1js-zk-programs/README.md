# o1js-zk-programs

A collection of zk-programs and utilities to support **Nori Bridge**.

## EthVerifier

A zk-program to verify an Ethereum consensus MPT transition proof, made verifiable (converted) in o1js.

It depends on:

- Public input 0 from the SP1 consensus MPT transition proof (`sp1Proof.proof.Plonk.public_inputs[0]`)
- Public output 2 from the converted consensus MPT transition proof (`proofConversionOutput.proofData.publicOutput[2]`)
- The verification key data from the `sp1ToPlonk` zk-program in [proof-conversion](https://github.com/Nori-zk/proof-conversion)

Whenever any of these change, you must run:

    npm run bake-vk-hashes

This updates the integrity files (used to ensure zk compilation is correct and not affected by stale o1js cache). Commit any changes to the `integrity` folder.

```typescript
import { EthVerifier, EthProof, EthInput } from '@nori-zk/o1js-zk-programs';
```

## Merkle Leaf Attestor Generator / Utils

A generator that produces zk-programs for proving a leaf’s inclusion (via a witness, generatable from all leaves) in a dynamically sized Merkle tree, with a constraint on the tree’s maximum height.

**Utilties**
```typescript
import {
    buildMerkleTree,
    foldMerkleLeft,
    getMerklePathFromLeaves,
    getMerklePathFromTree,
    computeMerkleRootFromPath,
    merkleLeafAttestorGenerator,
} from '@nori-zk/o1js-zk-programs';
```

**Example Usage**

```typescript
import { Bytes, Field, Poseidon, Struct, UInt8 } from 'o1js';
import { Bytes20, Bytes32 } from '@nori-zk/o1js-zk-programs';
import { merkleAttestorGenerator } from '@nori-zk/o1js-zk-programs';

export class YourLeafType extends Struct({
    value: Bytes32.provable,
}) {}

export function leafHashFunction(contractDeposit: YourLeafType) {
    const valueBytes = contractDeposit.value.bytes; // UInt8[]
    const leafBytes: UInt8[] = [];

    for (let i = 0; i < 32; i++) {
        leafBytes.push(valueBytes[i]);
    }
  
    let firstField = new Field(0);
    for (let i = 31; i >= 0; i--) {
        firstField = firstField.mul(256).add(firstBytes.bytes[i].value);
    }

    return Poseidon.hash([firstField]);
}

const {
    MerkleTreeAttestorInput: LeafInclusionAttestorInput,
    MerkleTreeAttestor: LeafInclusionAttestor,
    buildLeaves,
    getMerklePathFromLeaves: getLeafInclusionWitness,
} = merkleAttestorGenerator(
    16,
    'YourLeafInclusionAttestor',
    ContractDeposit,
    leafHashFunction
);

export {
    LeafInclusionAttestorInput,
    LeafInclusionAttestor,
    buildLeaves,
    getLeafInclusionWitness,
};
```

## Contract Deposit Attestor

A zk-program to prove that a user's deposit is included within a consensus MPT transition proof window.

**Leaf format:**
```typescript
export class ContractDeposit extends Struct({
  address: Bytes20.provable,         // User's Ethereum deposit address
  attestationHash: Bytes32.provable, // ECDSA attestation hash (user-signed public key hash)
  value: Bytes32.provable,           // Total locked amount (cumulative)
}) {}
```

**Imports**
```typescript
import {
    ContractDepositAttestorInput,
    ContractDepositAttestor,
    buildContractDepositLeaves,
    getContractDepositWitness,
    ContractDeposit,
} from '@nori-zk/o1js-zk-programs';
```

For example usage see the [test](./src/contractDepositAttestor.spec.ts).

## Utils

A range of utilities for handling proof byte encodings and ensuring zk compilation integrity.

```typescript
import {
    fieldToHexBE,
    fieldToHexLE,
    fieldToBigIntBE,
    fieldToBigIntLE,
    decodeConsensusMptProof,
    compileAndVerifyContracts,
} from '@nori-zk/o1js-zk-programs';
```

## Types

Types for various proof and encoding formats.

```typescript
import { PlonkProof, ConvertedProof, EthVerifierComputeOutput, Bytes32, Bytes20 } from '@nori-zk/o1js-zk-programs';
```
