# Mina zkApp: NoriTokenBridge

A Mina zkApp that verifies Ethereum consensus MPT transition proofs and settles state on-chain, enabling users to mint nETH tokens on Nori Bridge.

## Exports

### Node.js API

```typescript
import {
    NoriTokenBridge,          // Mina zkApp contract: verifies ETH state and manages mint lifecycle
    NoriStorageInterface,     // Per-user storage contract initialised during minting setup
    FungibleToken,            // Mina fungible token contract (TokenBase)
    NoriTokenBridgeSubmitter, // Tool for building and submitting transition proofs to NoriTokenBridge
    wait,                     // Polls the Mina RPC until a transaction is included or max retries reached
    signSecretWithEthWallet,  // Signs a secret with an Ethereum wallet for use in minting
    env,                      // Parsed environment configuration object
    noriTokenBridgeVkHash,    // Baked verification key hash for NoriTokenBridge (integrity check)
    noriStorageInterfaceVkHash, // Baked verification key hash for NoriStorageInterface
    fungibleTokenVkHash,      // Baked verification key hash for FungibleToken
} from '@nori-zk/mina-token-bridge-new/node';
```

### Browser API

```typescript
import {
    NoriTokenBridge,          // Mina zkApp contract
    NoriStorageInterface,     // Per-user storage contract
    FungibleToken,            // Token contract
    signSecretWithEthWallet,  // ETH wallet signing utility
    env,                      // Parsed environment configuration object
    noriTokenBridgeVkHash,    // Baked verification key hash for NoriTokenBridge
    noriStorageInterfaceVkHash, // Baked verification key hash for NoriStorageInterface
    fungibleTokenVkHash,      // Baked verification key hash for FungibleToken
} from '@nori-zk/mina-token-bridge-new/browser';
```

### WebSocket / Reactive API

```typescript
import { getReconnectingBridgeSocket$ } from '@nori-zk/mina-token-bridge-new/rx/socket';
// getReconnectingBridgeSocket$: creates a reconnecting WebSocket with heartbeat, auto-reconnect, and bridge topic subscriptions
// getBridgeSocket$: basic WebSocket without auto-reconnect

import {
    getBridgeStateTopic$,    // Observable: current bridge processing state
    getBridgeTimingsTopic$,  // Observable: bridge transition timing configuration
    getEthStateTopic$,       // Observable: current Ethereum finality state
} from '@nori-zk/mina-token-bridge-new/rx/topics';

import {
    BridgeDepositProcessingStatus, // Enum of deposit states: WaitingForEthFinality, ReadyToMint, etc.
    getDepositProcessingStatus$,   // Observable: full deposit status stream with time estimates
    canMint,                       // Promise: resolves when deposit is ReadyToMint, throws if missed
    readyToComputeMintProof,       // Promise: resolves when proof computation can begin
    bridgeStatusesKnownEnoughToLockUnsafe, // Promise: resolves as soon as all bridge streams emit once
    bridgeStatusesKnownEnoughToLockSafe,   // Promise: resolves only when last_finalized_job is known
    getCanMint$,                   // Observable: trinary mint status (ReadyToMint | MissedMintingOpportunity | 'Waiting')
    getCanComputeEthProof$,        // Observable: trinary compute status (CanCompute | MissedMintingOpportunity | 'Waiting')
    CanMintStatus,                 // Type
    CanComputEthProof,             // Type
} from '@nori-zk/mina-token-bridge-new/rx/deposit';
```

### Environment

`env` is a pre-baked configuration object keyed by network (`mina` | `zeko`) and environment (`development` | `staging` | `production`). Each entry contains the deployed contract addresses, token IDs, RPC URLs, and Nori service endpoints for that deployment — allowing consumers to import a ready-made configuration without manually specifying every value.

```typescript
import { env } from '@nori-zk/mina-token-bridge-new/env';
// or
import { env } from '@nori-zk/mina-token-bridge-new/node';

const config = env.mina?.staging;
// config.NORI_MINA_TOKEN_BRIDGE_ADDRESS  — deployed NoriTokenBridge address
// config.NORI_MINA_TOKEN_BASE_ADDRESS    — deployed FungibleToken address
// config.NORI_MINA_TOKEN_BASE_TOKEN_ID   — FungibleToken token ID
// config.NORI_MINA_TOKEN_BRIDGE_TOKEN_ID — NoriTokenBridge token ID
// config.MINA_RPC_NETWORK_URL            — Mina node GraphQL endpoint
// config.MINA_ARCHIVE_RPC_URL            — Mina archive node endpoint
// config.MINA_ZKAPP_TRANSACTION_RPC_URL  — zkApp transaction API endpoint
// config.MINA_RPC_NETWORK_ID             — Mina network ID ('mainnet' | 'testnet')
// config.NORI_WSS_URL                    — Nori bridge WebSocket endpoint
// config.NORI_PCS_URL                    — Nori proof conversion service endpoint (serves converted consensus MPT proofs)
```

## Workers

### Node.js worker usage

```typescript
import { getTokenBridgeWorker } from '@nori-zk/mina-token-bridge-new/node/workers/tokenBridgeWorker';
import { getTokenBridgeDeployerWorker } from '@nori-zk/mina-token-bridge-new/node/workers/tokenBridgeDeployer';

async function main() {
    const TokenBridgeWorker = getTokenBridgeWorker();
    const tokenBridgeWorker = new TokenBridgeWorker();
    // Method calls are buffered — ready check is optional
    await tokenBridgeWorker.ready;
    await tokenBridgeWorker.compileMinterDeps();
}
main();
```

### Browser worker usage

For browser environments, import the pure worker class and lift it into a worker manually.

```typescript
// workers/tokenBridgeWorker/browser/parent.ts
import { WorkerParent } from '@nori-zk/workers/browser/parent';
import { type TokenBridgeWorker as TokenBridgeWorkerType } from '@nori-zk/mina-token-bridge-new/workers/defs';
import { createProxy } from '@nori-zk/workers';

export function getTokenBridgeWorker() {
    const worker = new Worker(new URL('./child.ts', import.meta.url), {
        type: 'module',
    });
    const workerParent = new WorkerParent(worker);
    return createProxy<typeof TokenBridgeWorkerType>(workerParent);
}
```

```typescript
// workers/tokenBridgeWorker/browser/child.ts
import { TokenBridgeWorker } from '@nori-zk/mina-token-bridge-new/workers/defs';
import { WorkerChild } from '@nori-zk/workers/browser/child';
import { createWorker } from '@nori-zk/workers';

createWorker(new WorkerChild(), TokenBridgeWorker);
```

```typescript
import { getTokenBridgeWorker } from './workers/tokenBridgeWorker/browser/parent.ts';

async function main() {
    const TokenBridgeWorker = getTokenBridgeWorker();
    const tokenBridgeWorker = new TokenBridgeWorker();
    await tokenBridgeWorker.ready;
    await tokenBridgeWorker.compileMinterDeps();
    // Do other operations...
    tokenBridgeWorker.signalTerminate();
}
main();
```

## NoriTokenBridgeSubmitter

`NoriTokenBridgeSubmitter` is the programmatic API for building and submitting Ethereum→Mina state transition proofs to the deployed `NoriTokenBridge` contract.

```typescript
import { NoriTokenBridgeSubmitter } from '@nori-zk/mina-token-bridge-new/node';

const submitter = new NoriTokenBridgeSubmitter(); // reads env vars from process.env / .env
await submitter.networkSetUp();
await submitter.compileContracts();

const args = await submitter.createProof({ sp1PlonkProof, conversionOutputProof });
const { txId, txHash } = await submitter.submit(args);
```

### Constructor

Reads the following env vars (throws if any are missing):

- `MINA_SENDER_PRIVATE_KEY` — private key of the transaction sender
- `MINA_NETWORK` — `mainnet` | `devnet` | `lightnet`
- `MINA_RPC_NETWORK_URL` — Mina node GraphQL endpoint
- `MINA_TX_FEE` — transaction fee in MINA (default `0.1`)
- `NORI_MINA_TOKEN_BRIDGE_PRIVATE_KEY` — private key of the deployed NoriTokenBridge account
- `NORI_MINA_TOKEN_BASE_PRIVATE_KEY` — private key of the deployed FungibleToken account

An optional `FileSystemCacheConfig` argument can be passed to use an on-disk o1js compilation cache.

### Methods

- **`networkSetUp()`** — configures `Mina.Network` with the RPC endpoint from env.
- **`compileContracts()`** — compiles `NoriStorageInterface`, `FungibleToken`, and `NoriTokenBridge` in dependency order, verifying each against the baked integrity hashes. Populates `noriStorageInterfaceVerificationKey`, `fungibleTokenVerificationKey`, and `noriTokenBridgeVerificationKey` on the instance.
- **`createProof(arg: CreateProofArgument)`** — decodes a `sp1PlonkProof` (raw SP1/Plonk consensus proof) and `conversionOutputProof` (converted node proof) into `{ ethInput, rawProof }`. No ZK computation — `ethVerify` is inlined into `NoriTokenBridge.update`.
- **`submit({ ethInput, rawProof })`** — fetches on-chain accounts, builds and proves the `NoriTokenBridge.update` transaction, signs with `MINA_SENDER_PRIVATE_KEY`, and sends it. Returns `{ txId, txHash }`.
- **`deployContract(storeHash: Bytes32)`** — deploys `NoriTokenBridge` and `FungibleToken` in a single transaction. Throws if `MINA_NETWORK` is not `lightnet` — use `npm run deploy` for non-test deployments.

## How to build

```sh
npm run build
```

## Configuration

Create a `.env` file in `contracts/mina/mina-token-bridge/`:

```
MINA_RPC_NETWORK_URL=
MINA_SENDER_PRIVATE_KEY=
MINA_TX_FEE=
MINA_NETWORK=

NORI_MINA_TOKEN_BRIDGE_PRIVATE_KEY=
NORI_MINA_TOKEN_BRIDGE_ADDRESS=
NORI_MINA_TOKEN_BASE_PRIVATE_KEY=
NORI_MINA_TOKEN_BASE_ADDRESS=
NORI_MINA_TOKEN_BRIDGE_ADMIN=
NORI_MINA_TOKEN_BASE_TOKEN_ID=
NORI_MINA_TOKEN_BRIDGE_TOKEN_ID=
NORI_MINA_TOKEN_BASE_ALLOW_VK_UPDATE=
NORI_MINA_TOKEN_BRIDGE_ALLOW_VK_UPDATE=
```

- **MINA_RPC_NETWORK_URL**: Mina network RPC endpoint URL.
- **MINA_SENDER_PRIVATE_KEY**: private key of the transaction sender.
- **MINA_TX_FEE**: transaction fee (e.g. `0.1`). Defaults to `0.1` if not set.
- **MINA_NETWORK**: target network (`mainnet`, `devnet`, `lightnet`).

- **NORI_MINA_TOKEN_BRIDGE_PRIVATE_KEY**: private key for the NoriTokenBridge account. Generated by `npm run deploy` and written to `.env.nori-mina-token-bridge`. Must **not** be set when running `npm run deploy` — it will be rejected.
- **NORI_MINA_TOKEN_BRIDGE_ADDRESS**: deployed address of the NoriTokenBridge contract. Generated by `npm run deploy`.
- **NORI_MINA_TOKEN_BASE_PRIVATE_KEY**: private key for the FungibleToken (TokenBase) account. Generated by `npm run deploy`. Must **not** be set when running `npm run deploy` — it will be rejected.
- **NORI_MINA_TOKEN_BASE_ADDRESS**: deployed address of the FungibleToken contract. Generated by `npm run deploy`.
- **NORI_MINA_TOKEN_BRIDGE_ADMIN**: public key of the contract admin account. Generated by `npm run deploy` (defaults to the public key derived from `MINA_SENDER_PRIVATE_KEY`).
- **NORI_MINA_TOKEN_BASE_TOKEN_ID**: token ID of the FungibleToken. Generated by `npm run deploy`.
- **NORI_MINA_TOKEN_BRIDGE_TOKEN_ID**: token ID of the NoriTokenBridge. Generated by `npm run deploy`.
- **NORI_MINA_TOKEN_BASE_ALLOW_VK_UPDATE**: controls whether the FungibleToken verification key can be updated (`true`/`false`).
- **NORI_MINA_TOKEN_BRIDGE_ALLOW_VK_UPDATE**: controls whether the NoriTokenBridge verification key can be updated (`true`/`false`).

## How to bake integrity hashes

When `NoriTokenBridge`, `NoriStorageInterface`, or `FungibleToken` are modified, or when any public inputs/outputs change due to updates in dependent zk programs (e.g. from `proof-conversion` or `bridge-head`), recompile and update the integrity data.

`NoriTokenBridge.update` verifies the Ethereum state transition. The circuit depends on:

- Public input 0 from the SP1 consensus MPT transition proof (`sp1Proof.proof.Plonk.public_inputs[0]`), the Nori SP1 Helios program identifier (`bridgeHeadNoriSP1HeliosProgramPi0`), stored in [`o1js-zk-utils/src/integrity/nori-sp1-helios-program.pi0.json`](../../../o1js-zk-utils/src/integrity/nori-sp1-helios-program.pi0.json) — a copy of [`nori-elf/nori-sp1-helios-program.pi0.json`](https://github.com/Nori-zk/nori-bridge-head/blob/develop/nori-elf/nori-sp1-helios-program.pi0.json) from [bridge-head](https://github.com/Nori-zk/nori-bridge-head). Changes frequently as the Helios light client evolves — when bridge-head releases a new version, copy [`nori-elf/nori-sp1-helios-program.pi0.json`](https://github.com/Nori-zk/nori-bridge-head/blob/develop/nori-elf/nori-sp1-helios-program.pi0.json) from the appropriate release tag into [`o1js-zk-utils/src/integrity/nori-sp1-helios-program.pi0.json`](../../../o1js-zk-utils/src/integrity/nori-sp1-helios-program.pi0.json) before re-running `bake-vk-hashes`.
- Public output 2 from the converted consensus MPT transition proof (`proofConversionOutput.proofData.publicOutput[2]`). Infrequently changes, for instance when SP1 undergoes a major version upgrade (e.g. v5 -> v6) that affects the cryptography of proof conversion.
- The verification key data from the `sp1Plonk` zk-program in [proof-conversion](https://github.com/Nori-zk/proof-conversion). Unlikely to change.

Changes to any of these — through a `proof-conversion` or `bridge-head` update — require re-running `bake-vk-hashes` before running `deploy`, `update-store-hash`, or `prove-and-submit`.

For `migrate-vk-to-tag` and `update-vk` the relationship with `bake-vk-hashes` is more nuanced: `migrate-vk-to-tag` is a VK migration workflow that runs `bake-vk-hashes` on the target commitish rather than the current checkout as part of its process — see [How to update the verification key](#how-to-update-the-verification-key).

Run:

```bash
npm run bake-vk-hashes
```

This regenerates:

```
src/integrity/NoriTokenBridge.VkHash.json    — verification key hash
src/integrity/NoriTokenBridge.VkData.json    — verification key data
src/integrity/NoriStorageInterface.VkHash.json
src/integrity/FungibleToken.VkHash.json
```

These files are checked at runtime during:

- `npm run deploy`
- `npm run update-vk` / `npm run migrate-vk-to-tag`
- `npm run update-store-hash`
- `npm run prove-and-submit`
- `NoriTokenBridgeSubmitter.compileContracts` (API method)

If the compiled verification key does not match the stored integrity hash, these commands will throw before any transaction is submitted.

## How to deploy

From `contracts/mina/mina-token-bridge/`, ensure your `.env` contains:

```
MINA_RPC_NETWORK_URL=<url>
MINA_NETWORK=<mainnet|devnet|lightnet>
MINA_SENDER_PRIVATE_KEY=<your-private-key>
MINA_TX_FEE=0.1
```

Do **not** set `NORI_MINA_TOKEN_BRIDGE_PRIVATE_KEY` or `NORI_MINA_TOKEN_BASE_PRIVATE_KEY` — the deploy script generates fresh key pairs and will reject the run if either is already set.

Clear your o1js cache before deploying:

```bash
rm -rf ~/.cache/o1js/
```

Run:

```bash
npm run deploy <storeHashInHex> [adminPublicKeyBase58]
```

- `<storeHashInHex>`: must match the `input_store_hash` of the first store you expect as a checkpoint, **omitting** the `0x` prefix.
- `[adminPublicKeyBase58]`: optional. The public key of the account with admin permissions over the contract (`setVerificationKey`, `updateStoreHash`). If omitted, defaults to the public key derived from `MINA_SENDER_PRIVATE_KEY`.

You can find sensible values by running the bridge head and inspecting the checkpoint you want to start from in the proof output message directory:
`sp1-helios-proof-messages/<file-with-slot-height>.json`
Locate the `input_store_hash` field.

After deploy, a `.env.nori-mina-token-bridge` file is created in the root directory containing:

```
NORI_MINA_TOKEN_BRIDGE_PRIVATE_KEY=...
NORI_MINA_TOKEN_BRIDGE_ADDRESS=...
NORI_MINA_TOKEN_BASE_PRIVATE_KEY=...
NORI_MINA_TOKEN_BASE_ADDRESS=...
NORI_MINA_TOKEN_BRIDGE_ADMIN=...
NORI_MINA_TOKEN_BASE_TOKEN_ID=...
NORI_MINA_TOKEN_BRIDGE_TOKEN_ID=...
NORI_MINA_TOKEN_BASE_ALLOW_VK_UPDATE=true
NORI_MINA_TOKEN_BRIDGE_ALLOW_VK_UPDATE=false
```

Copy these values into your `.env` file.

## How to update a store hash

From `contracts/mina/mina-token-bridge/`, ensure your `.env` contains:

```
MINA_RPC_NETWORK_URL=<url>
MINA_NETWORK=<mainnet|devnet|lightnet>
MINA_SENDER_PRIVATE_KEY=<contract-admin-private-key>
NORI_MINA_TOKEN_BRIDGE_PRIVATE_KEY=<deployed-bridge-private-key>
MINA_TX_FEE=0.1
```

Run:

```bash
npm run update-store-hash <storeHashInHex>
```

The `<storeHashInHex>` must match the `input_store_hash` of the store you expect as a checkpoint, **omitting** the `0x` prefix.

You can find sensible values by running the bridge head and inspecting the checkpoint in:
`sp1-helios-proof-messages/<file-with-slot-height>.json`

## How to submit a new converter proof

From `contracts/mina/mina-token-bridge/`, ensure your `.env` contains:

```
MINA_RPC_NETWORK_URL=<url>
MINA_NETWORK=<mainnet|devnet|lightnet>
MINA_SENDER_PRIVATE_KEY=<your-private-key>
NORI_MINA_TOKEN_BRIDGE_PRIVATE_KEY=<deployed-bridge-private-key>
MINA_TX_FEE=0.1
```

Edit `src/proofs/sp1Proof.json` using the output retrieved from the bridge head within the `sp1-helios-proofs` directory. Convert this proof via the `proof-conversion` repository using the `sp1Plonk` command. Then update `src/proofs/p0.json` with the converted proof data from the output (`<proof-data-output>.proofData`).

Note: only update `nodeVk.json` from the proof conversion output if the proof conversion program's VK has changed.

Then:

```bash
npm run prove-and-submit
```

## How to update the verification key

`setVerificationKey` is a provable contract method: the proof must be generated using the circuit that is currently deployed on-chain. This means you must be running the code from the currently deployed contract version — not the version you are migrating to. The new verification key data is sourced separately from the target release's committed integrity files.

The recommended approach is `migrate-vk-to-tag`, which handles the full workflow automatically.

**Before you do anything else**, check out the git tag that corresponds to the currently deployed contract version:

```bash
git checkout <currently-deployed-tag>
```

This is the tag whose circuit is live on-chain. If you run `migrate-vk-to-tag` from the wrong checkout, the proof will be generated by the wrong circuit and will be rejected by the contract.

Once checked out to the deployed tag:

1. From the **monorepo root**, reinstall dependencies from scratch and build:

```bash
npm run reinstall:ci && npm run build
```

2. Clear the o1js cache:

```bash
rm -rf ~/.cache/o1js/
```

3. From `contracts/mina/mina-token-bridge/`, ensure your `.env` contains:

```
MINA_RPC_NETWORK_URL=<url>
MINA_NETWORK=<mainnet|devnet|lightnet>
MINA_SENDER_PRIVATE_KEY=<contract-admin-private-key>
NORI_MINA_TOKEN_BRIDGE_PRIVATE_KEY=<deployed-bridge-private-key>
MINA_TX_FEE=0.1
```

`NORI_MINA_TOKEN_BRIDGE_PRIVATE_KEY` must be the private key of the deployed NoriTokenBridge account — the contract address is derived from it. `MINA_SENDER_PRIVATE_KEY` must be the contract admin's private key.

4. From `contracts/mina/mina-token-bridge/`, run:

```bash
npm run migrate-vk-to-tag <targetTagOrCommitSHA>
```

where `<targetTagOrCommitSHA>` is the release you are migrating **to**.

The script clones the target commitish to a temporary directory, installs dependencies, runs `bake-vk-hashes`, verifies the committed integrity files are not stale, then invokes `update-vk` against the target integrity files using the current checkout's circuit to generate the proof. The temporary directory is cleaned up on completion or failure.

## How to update the verification key directly (not recommended)

> **Warning:** `update-vk` bypasses the integrity verification step performed by `migrate-vk-to-tag`. If the integrity files you supply are stale or incorrect, the contract will be bricked. Only use this if you have independently verified the integrity files are correct and understand the risks.

You must still be checked out to the currently deployed contract version. Check out the deployed tag, then from the **monorepo root**:

```bash
git checkout <currently-deployed-tag>
npm run reinstall:ci && npm run build
rm -rf ~/.cache/o1js/
```

From `contracts/mina/mina-token-bridge/`, ensure your `.env` contains:

```
MINA_RPC_NETWORK_URL=<url>
MINA_NETWORK=<mainnet|devnet|lightnet>
MINA_SENDER_PRIVATE_KEY=<contract-admin-private-key>
NORI_MINA_TOKEN_BRIDGE_PRIVATE_KEY=<deployed-bridge-private-key>
MINA_TX_FEE=0.1
```

Then run:

```bash
npm run update-vk -- <path/to/NoriTokenBridge.VkData.json> <path/to/NoriTokenBridge.VkHash.json>
```

## How to run tests

Obtain a `MINA_SENDER_PRIVATE_KEY` environment variable:

1. `npm install -g zkapp-cli`
2. `zk lightnet start`

```sh
npm run test                                                        # all tests
npm run test -- -t "should perform a series of proof submissions"  # specific test
npm run test:unit                                                   # unit tests only
npm run test:integration                                            # integration tests only
npm run test:e2e                                                    # e2e tests only
npm run testw                                                       # watch mode
```

Tests can hang after multiple rounds of proof computation when running in the same process. Run them individually if this occurs, or use:

```sh
npm run test-ci
```

which runs each proof submission test as a separate process with `--forceExit`.

## How to run coverage

```sh
npm run coverage
```

## Troubleshooting

If you expect the project's verification keys to have changed, remove the o1js cache before running any deploy or prove command:

```bash
rm -rf ~/.cache/o1js/
```

## License

[Apache-2.0](LICENSE)
