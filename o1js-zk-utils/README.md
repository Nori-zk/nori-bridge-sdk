# o1js-zk-utils

A collection of zk-programs and utilities to support **Nori Bridge**.

## EthVerifier

A zk-program to verify an Ethereum consensus MPT transition proof, made verifiable (converted) in o1js.

It depends on:

- Public input 0 from the SP1 consensus MPT transition proof (`sp1Proof.proof.Plonk.public_inputs[0]`), the Nori SP1 Helios program identifier (`bridgeHeadNoriSP1HeliosProgramPi0`), stored in [`src/integrity/nori-sp1-helios-program.pi0.json`](./src/integrity/nori-sp1-helios-program.pi0.json) — a copy of [`nori-elf/nori-sp1-helios-program.pi0.json`](https://github.com/Nori-zk/nori-bridge-head/blob/develop/nori-elf/nori-sp1-helios-program.pi0.json) from [bridge-head](https://github.com/Nori-zk/nori-bridge-head). Changes frequently as the Helios light client evolves — when bridge-head releases a new version, copy [`nori-elf/nori-sp1-helios-program.pi0.json`](https://github.com/Nori-zk/nori-bridge-head/blob/develop/nori-elf/nori-sp1-helios-program.pi0.json) from the appropriate release tag into [`src/integrity/nori-sp1-helios-program.pi0.json`](./src/integrity/nori-sp1-helios-program.pi0.json) before re-running `bake-vk-hashes`.
- Public output 2 from the converted consensus MPT transition proof (`proofConversionOutput.proofData.publicOutput[2]`). Infrequently changes, for instance when SP1 undergoes a major version upgrade (e.g. v5 -> v6) that affects the cryptography of proof conversion.
- The verification key data from the `sp1Plonk` zk-program in [proof-conversion](https://github.com/Nori-zk/proof-conversion). Unlikely to change.

Whenever any of these change, you must run:

    npm run bake-vk-hashes

This updates the integrity files (used to ensure zk compilation is correct and not affected by stale o1js cache). Commit any changes to the `integrity` folder.

```typescript
import { EthVerifier, EthProof, EthInput } from '@nori-zk/o1js-zk-utils';
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
} from '@nori-zk/o1js-zk-utils';
```

**Example Usage**

```typescript
import { Field, Poseidon, Struct, UInt8 } from 'o1js';
import { Bytes32 } from '@nori-zk/o1js-zk-utils';
import { merkleLeafAttestorGenerator } from '@nori-zk/o1js-zk-utils';

export class YourLeafType extends Struct({
    value: Bytes32.provable,
}) {}

export function leafHashFunction(leaf: YourLeafType) {
    const valueBytes = leaf.value.bytes; // UInt8[]
    const leafBytes: UInt8[] = [];

    for (let i = 0; i < 32; i++) {
        leafBytes.push(valueBytes[i]);
    }

    let firstField = new Field(0);
    for (let i = 31; i >= 0; i--) {
        firstField = firstField.mul(256).add(leafBytes[i].value);
    }

    return Poseidon.hash([firstField]);
}

const {
    MerkleTreeLeafAttestorInput: LeafInclusionAttestorInput,
    MerkleTreeLeafAttestor: LeafInclusionAttestor,
    buildLeaves,
    getMerklePathFromLeaves: getLeafInclusionWitness,
} = merkleLeafAttestorGenerator(
    16,
    'YourLeafInclusionAttestor',
    YourLeafType,
    leafHashFunction
);

export {
    LeafInclusionAttestorInput,
    LeafInclusionAttestor,
    buildLeaves,
    getLeafInclusionWitness,
};
```

## Verified Request Attestor

`NoriProofRequestQueue` lets any Ethereum contract request a proof of the value currently held at one of
its own storage locations. What can be proven:

- A plain storage slot.
- A value inside a collection, such as one entry of a mapping or array.
- A value inside a nested collection, such as one entry of a mapping of mappings.

Each request carries `collectionKeysCount` and `collectionKeys`, which record the type of data structure
the proven value belongs to: `collectionKeysCount` is 0 for a top-level plain slot, 1 for a collection
(a mapping or array), or 2 for a nested structure (for example, an array of arrays, or a mapping of
mappings).

Ethereum resolves a mapping entry to its actual storage slot by hashing the collection's base slot
together with its key (nested, its keys); the resolved slot doesn't carry those keys back out, so a
request also supplies `slotKey`, computed the same way Solidity would compute it:

```solidity
// slot 0, plain value
uint256 public totalSupply;

// slot 1, collection
mapping(address => uint256) public balances;

// slot 2, nested collection
mapping(address => mapping(bytes32 => uint256)) public locked;
```

| Value | `slotKey` | `collectionKeysCount` | `collectionKeys` |
| --- | --- | --- | --- |
| `totalSupply` | `bytes32(uint256(0))` | 0 | unused |
| `balances[user]` | `keccak256(abi.encode(user, uint256(1)))` | 1 | `[bytes32(uint256(uint160(user)))]` |
| `locked[user][challenge]` | `keccak256(abi.encode(challenge, keccak256(abi.encode(user, uint256(2)))))` | 2 | `[bytes32(uint256(uint160(user))), challenge]` |

The queue stores the request under a sequential id, with `target` set to the calling contract's own
address.

The Nori SP1 consensus and MPT program later processes these requests in order. For each one it proves
the value at the storage slot `slotKey` points to against the Ethereum execution state root. The output
is a `VerifiedRequest`: the proven value, together with the `target` and `collectionKeys` the request
was queued with. `slotKey` itself is only used to locate the slot; it is not carried into the
`VerifiedRequest`.

This zk-program (the "attestor") proves that one specific `VerifiedRequest` is a leaf of the Merkle tree
whose root the consensus proof commits to. Nori's bridge is one consumer of the queue, using it to
prove a user's locked balance, but any contract can enqueue a request for any slot of its own storage.

**Leaf format:**

```typescript
export class VerifiedRequest extends Struct({
    target: Bytes20.provable, // The contract that owns the proven storage slot; set by the queue to the requester's own address
    collectionKeysCount: UInt8, // 0 for a plain slot, 1 for a collection value, 2 for a nested-collection value
    collectionKeys: Provable.Array(Bytes32.provable, MAX_COLLECTION_KEYS), // The key(s) that locate the value, in nesting order, as supplied at enqueue time
    value: Bytes32.provable, // The proven value of the request's storage slot
}) {}
```

**Imports**

```typescript
import {
    VerifiedRequestAttestorInput,
    VerifiedRequestAttestor,
    buildVerifiedRequestLeaves,
    getVerifiedRequestWitness,
    VerifiedRequest,
} from '@nori-zk/o1js-zk-utils';
```

For example usage see the [test](./src/VerifiedRequestAttestor.spec.ts).

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
    extractEthTokenBridgeAddressFromSP1Proof,
} from '@nori-zk/o1js-zk-utils';
```

## Types

Types for various proof and encoding formats.

```typescript
import {
    PlonkProof,
    ConvertedProof,
    EthVerifierComputeOutput,
    Bytes32,
} from '@nori-zk/o1js-zk-utils';
```
