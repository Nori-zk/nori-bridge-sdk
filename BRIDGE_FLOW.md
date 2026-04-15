# Nori Bridge — Complete Flow Documentation

End-to-end flow for bridging ETH to nETH (Mina) via the Nori bridge.

## Architecture Overview

See [bridge_flow.html](bridge_flow.html) for the full visual diagram (open in any browser).

```
+-------------------+     +---------------------+     +---------------------+
|    Ethereum        |     |   Bridge Service     |     |       Mina          |
|                   |     |                     |     |                     |
| ETH Token Bridge  | --> | SP1 Helios prover   | --> | NoriTokenBridge     |
| (lockTokens)      |     | Proof Conversion    |     | (update, noriMint)  |
|                   |     | WebSocket state pub |     | FungibleToken (nETH)|
+-------------------+     +---------------------+     +---------------------+
        ^                         |                           ^
        |                         v                           |
        +--- Client (browser/node) via TokenBridgeWorker -----+
```

## Actors

| Actor | Description |
|-------|-------------|
| **Client** | Browser (minimal-client) or Node.js (e2e tests). Uses `TokenBridgeWorker` proxy for ZK computation. |
| **ETH Token Bridge** | Solidity contract on Ethereum. Accepts ETH deposits with a credential attestation (code challenge). Stores deposits in `lockedTokens` map keyed by code challenge. |
| **Bridge Service** | Off-chain service that monitors Ethereum, generates SP1 Helios proofs, converts them, and submits `update()` to Mina. Publishes real-time state via WebSocket. |
| **Proof Conversion Service (PCS)** | HTTP API serving converted proofs and ETH contract storage slot data. Client fetches all deposit slots from PCS to build their Merkle witness for minting. |
| **NoriTokenBridge** | o1js smart contract on Mina (`TokenContract`). Verifies proofs, tracks Ethereum state, manages a deposit root action window via reducer, and gates nETH minting. |
| **FungibleToken** | Standard o1js token contract. Admin-gated by NoriTokenBridge — only `noriMint()` can trigger minting via the `mintLock` mechanism. |
| **NoriStorageInterface** | Per-user storage contract (child token account under NoriTokenBridge's token ID). Tracks `mintedSoFar`, `burnedSoFar`, `userKeyHash`, and `receiver`. |

## Detailed Flow

### Phase 1: Client Preparation (Steps 1-2)

#### Step 1 — SCRAM Sign
The client signs a fixed message (e.g., `"NoriZK25"`) using their Mina private key.

```
signatureSCRAM = Signature.create(minaPrivateKey, CircuitString.fromString("NoriZK25").values.map(c => c.toField()))
```

This creates a deterministic signature that can be regenerated on any machine using the same Mina key and message. If the user provides a secret message instead, they gain extra security but must remember it.

See: `scram.ts` — SCRAM (Signature Commit-Reveal Authentication Mechanism) module.

#### Step 2 — Create Code Challenge
The signature is hashed via Poseidon to produce a `codeChallenge` field element:

```
codeChallenge = Poseidon.hash(signatureSCRAM.toFields())
```

This code challenge is:
- Committed on Ethereum during the deposit (stored as the deposit key in the `lockedTokens` and `depositKeyToEthAddress` maps)
- Verified on Mina during minting (SCRAM witness proves knowledge of the pre-image inside a ZK circuit)

### Phase 2: Ethereum Deposit (Step 3)

#### Step 3 — Lock Tokens on Ethereum
The client calls `lockTokens(codeChallenge, { value: depositAmount })` on the ETH Token Bridge contract.

- Minimum deposit: 0.0001 ETH (100 bridge units)
- The `codeChallenge` becomes the deposit key in the contract's storage maps
- The transaction receipt provides `depositBlockNumber` — used throughout the rest of the flow to track processing

### Phase 3: Bridge Processing (Steps 4-7)

The bridge service runs autonomously. The client monitors its progress via WebSocket topics.

#### WebSocket Topics
| Topic | Data |
|-------|------|
| `state.eth` | `latest_finality_block_number`, `latest_finality_slot` |
| `state.bridge` | `stage_name`, `input/output_block_number`, `input/output_slot`, `elapsed_sec`, `last_finalized_job` |
| `timings.notices.transition` | Stage transition timing metadata (expected durations per stage) |

#### Client Status Tracking
The client uses `getDepositProcessingStatus$(depositBlockNumber, ...)` which emits one of:

1. **WaitingForEthFinality** — Deposit block not yet finalized on the Ethereum beacon chain
2. **WaitingForPreviousJobCompletion** — Deposit is not in the current bridge job window (must wait for its window)
3. **WaitingForCurrentJobCompletion** — Bridge is actively processing the job that includes this deposit
4. **ReadyToMint** — Bridge has submitted the proof to Mina (`EthProcessorTransactionFinalizationSucceeded`); client can mint
5. **MissedMintingOpportunity** — Window has rotated past this deposit; cannot be minted

Additional RxJS utilities:
- `readyToComputeMintProof()` — resolves when proof conversion succeeds (stage ≥ `ProofConversionJobSucceeded` while in `WaitingForCurrentJobCompletion`, or `ReadyToMint`)
- `canMint()` — resolves when deposit reaches `ReadyToMint` status
- `bridgeStatusesKnownEnoughToLockUnsafe()` / `...Safe()` — gate the deposit to prevent misclassification after WebSocket restarts

#### Step 4 — Monitor Ethereum Finality
Bridge waits for the deposit's block to reach finality on the Ethereum beacon chain (typically ~12-15 minutes).

#### Step 5 — SP1 Helios Proof Generation
Bridge generates an SP1 proof covering:
- Ethereum consensus (beacon chain light client sync via Helios)
- MPT storage proof of deposits on the ETH bridge contract

SP1 public values (196 bytes): `inputSlot` (8B), `inputStoreHash` (32B), `outputSlot` (8B), `outputStoreHash` (32B), `executionStateRoot` (32B), `verifiedContractDepositsRoot` (32B), `nextSyncCommitteeHash` (32B), `contractAddress` (20B).

#### Step 6 — Proof Conversion (SP1 PLONK → o1js-compatible)
The SP1 PLONK proof is converted into a `NodeProofLeft` verifiable by o1js circuits. The conversion output's `publicOutput.subtreeVkDigest` must match the on-chain `proofConversionPO2`, and the public inputs digest must match the on-chain `noriHeliosProgramPi0`.

#### Step 7 — Submit `update()` Transaction to Mina
Bridge service (via `NoriTokenBridgeSubmitter`) calls `NoriTokenBridge.update(ethInput, convertedProof, oldestAction)`:

1. **Verify proof**: `ethVerify()` checks `NodeProofLeft` against on-chain VK, validates `subtreeVkDigest` == `po2`, validates public inputs digest using `pi0`
2. **Validate ETH bridge address**: extracted contract address from proof must match on-chain `ethTokenBridgeAddress`
3. **Validate store hash chain**: proof's `inputStoreHash` must match on-chain `latestHeliusStoreInputHash` (high + low) — ensures sequential proof submission with no gaps
4. **Validate slot progress**: `proofHead > currentSlot`
5. **Validate sync committee**: `nextSyncCommitteeHash ≠ 0` (prevents bricking the bridge head)
6. **Update state**: advances `latestHead`, `verifiedStateRoot`, store hash fields, `latestVerifiedContractDepositsRoot`
7. **Dispatch deposit root**: `dispatchAndEvict(verifiedContractDepositsRootField, oldestAction)` — dispatches the deposit root as a reducer action and evicts the oldest if the window (max 32) is full

### Phase 4: Client Minting (Steps 8-11)

#### Step 8 — Compute Deposit Attestation Witness
Once `readyToComputeMintProof()` resolves (proof conversion succeeded), the client fetches deposit data from PCS:

```
GET {pcsUrl}/converted-consensus-mpt-proofs/{depositBlockNumber}
```

This returns `contract_storage_slots` — the full set of deposits at that block. Each slot has `slot_key_code_challenge` and `value` (total locked amount). The client:

1. Pads and normalises all slot hex values to 64 chars
2. Finds their deposit by matching `codeChallenge` (converted to big-endian hex)
3. Builds `ContractDeposit` objects (each containing `Bytes32` codeChallenge + `Bytes32` value)
4. Hashes leaves via `provableStorageSlotLeafHash()` (3-field Poseidon: splits 64 bytes into high bytes + lower 31B each)
5. Constructs a Poseidon Merkle tree (depth 16) from all deposit leaves
6. Returns `MerkleTreeContractDepositAttestorInputJson`: Merkle path + deposit index + raw deposit slot data

#### Step 9 — Set Up Storage (one-time)
If the user hasn't minted before, they must call `setUpStorage(userPublicKey, storageInterfaceVK)`:
- Creates a `NoriStorageInterface` child account under NoriTokenBridge's token ID
- Requires the account to be new (`isNew == true`)
- Verification key must match on-chain `storageVKHash`
- Sets `userKeyHash = Poseidon.hash(userPublicKey.toFields())`
- Sets `mintedSoFar = 0`

#### Step 10 — Mint nETH
After `canMint()` resolves (bridge processing complete, deposit root is in the action window), the client calls `noriMint(depositAttestationInput, scramWitness)`:

**On-chain verification (ZK circuit):**
1. Recompute `contractDepositSlotRoot` from the Merkle witness (path + index + leaf hash)
2. **Reducer membership check**: fetch actions from `windowStart` to current action state via `reducer.getActions()`, then `reducer.reduce()` to verify the computed root exists among dispatched deposit roots (max 32 iterations)
3. Extract `totalLocked` and `codeChallenge` from the deposit attestation input bytes
4. Verify SCRAM: `verifyCodeChallenge(codeChallenge, signature, sender, message)` — verifies the signature is valid for the sender's public key + message, AND that `Poseidon.hash(signature) == codeChallenge`
5. Verify storage identity: `userKeyHash == Poseidon.hash(sender.toFields())` and account is not new
6. Calculate `amountToMint = totalLocked - mintedSoFar` (via `NoriStorageInterface.increaseMintedAmount`) — asserts non-negative and non-zero
7. Update `mintedSoFar` in storage

#### Step 11 — FungibleToken.mint()
NoriTokenBridge sets `mintLock = false`, then calls `FungibleToken.mint(userAddress, amountToMint)`. The `canMint()` callback on FungibleToken checks `mintLock == false` and resets it to `true`. This ensures only `noriMint()` can trigger minting — direct `FungibleToken.mint()` calls are blocked because `mintLock` starts as `true`.

## Burn Flow (nETH → ETH)

`NoriTokenBridge.alignedLock(amountToBurn, receiver)`:
- Burns nETH via `FungibleToken.burn(sender, amount)`
- Tracks cumulative `burnedSoFar` and `receiver` (ETH address) in `NoriStorageInterface`
- Emits a `Burn` event with `from`, `amount`, `burnedSoFar`, `receiverEth`
- Minimum burn amount: 100 bridge units

## On-Chain State (NoriTokenBridge)

| Field | Purpose |
|-------|---------|
| `adminPublicKey` | Admin key for privileged operations |
| `tokenBaseAddress` | FungibleToken contract address |
| `storageVKHash` | Expected verification key hash for NoriStorageInterface |
| `mintLock` | Gate for FungibleToken.mint() — only noriMint toggles it |
| `latestHead` | Latest verified Ethereum beacon chain slot (UInt64) |
| `verifiedStateRoot` | Poseidon hash of last verified execution state root |
| `latestHeliusStoreInputHashHighByte` | Store hash chain — high byte field |
| `latestHeliusStoreInputHashLowerBytes` | Store hash chain — lower 31 bytes field |
| `latestVerifiedContractDepositsRoot` | Latest deposits Merkle root from verified proof |
| `noriHeliosProgramPi0` | SP1 program identifier — public input 0 (FrC, set by admin) |
| `proofConversionPO2` | Proof conversion VK digest — public output 2 (Field, set by admin) |
| `ethTokenBridgeAddress` | ETH bridge contract address (Field, set at deploy) |
| `windowStart` | Action-state hash marking the start of the valid deposit-root window |
| `windowSize` | Current number of deposit roots in the window (max 32) |

## Integrity Parameters (pi0 + po2)

These are on-chain state fields (not circuit constants) that must be set by the admin after deployment:
- **pi0** (`noriHeliosProgramPi0`): First public input of the SP1 PLONK proof — identifies the Helios program. Changes frequently as the Helios light client evolves.
- **po2** (`proofConversionPO2`): Third public output of the proof conversion — the subtree VK digest. Changes infrequently (e.g., SP1 major version upgrades).

They can be updated without recompiling/redeploying the contract via `setNoriHeliosProgramPi0()` and `setProofConversionPO2()` (admin-gated). A combined `setIntegrityParams()` is available on the submitter.

## Action Window (Reducer)

The deposit root window is implemented using o1js `Reducer` actions:
- `dispatchAndEvict()` dispatches a new deposit root as an action and manages the window
- When `windowSize < maxWindow (32)`: simply append (increment windowSize)
- When `windowSize >= maxWindow`: caller provides `oldestAction` as a witness; contract verifies the hash chain `advanceActionState(windowStart, singleActionInnerHash(oldestAction))` and advances `windowStart`, keeping size constant
- `noriMint()` fetches all actions from `windowStart` to current action state and reduces them to check membership
- Off-chain helpers: `fetchWindowRoots()`, `fetchAllDispatchedRoots()`, `getOldestActionForEviction()` in `NoriTokenBridge.utils.ts`

## Security Model

| Mechanism | Protection |
|-----------|-----------|
| **SCRAM** | Only the Mina key holder who deposited can mint — Poseidon-based signature commitment verified inside ZK circuit |
| **Store hash chain** | Proofs must be sequential — each `inputStoreHash` must match on-chain output, preventing gaps or replays |
| **Action window** | Deposit roots expire after 32 new submissions — bounded state growth, time-limited minting |
| **mintLock** | Prevents direct FungibleToken.mint() bypass — only noriMint() can toggle it |
| **storageVKHash** | Ensures only the correct NoriStorageInterface program runs in the token account |
| **ETH address validation** | `update()` verifies proof's extracted contract address matches on-chain `ethTokenBridgeAddress` |
| **Non-zero sync committee** | `update()` asserts `nextSyncCommitteeHash ≠ 0` to prevent bricking the bridge head |
| **ensureAdminSignature** | Admin-gated setters (pi0, po2, updateStoreHash, adminSetDepositRoot, VK upgrade) |
| **Permissions** | `setPermissions: impossible()`, `editState: proof()`, `send: proof()`, `access: proof()` |

## Package Map

| Package | Role |
|---------|------|
| `@nori-zk/mina-token-bridge-new` | NoriTokenBridge, FungibleToken, NoriStorageInterface contracts, workers, RxJS bridge communication, deposit attestation, SCRAM |
| `@nori-zk/ethereum-token-bridge` | ETH Token Bridge contract ABI, typechain factory |
| `@nori-zk/o1js-zk-utils-new` | EthInput, NodeProofLeft, proof decoding, integrity constants (pi0/po2 values), Bytes32/Bytes20/Bytes32FieldPair types, Merkle tree utilities |
| `@nori-zk/proof-conversion` | FrC type, proof conversion utilities, `parsePlonkPublicInputsProvable` |
| `@nori-zk/pts-types` | Bridge WebSocket message types, transition stage enums |
| `@nori-zk/workers` | Cross-environment worker framework (WorkerParent/WorkerChild, createProxy) |
| `nori-client-minimal` | Browser-based reference client implementation |
