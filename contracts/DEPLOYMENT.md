# NoriTokenBridge — Production Deployment Runbook

End-to-end procedure to deploy the Mina ↔ Ethereum bridge in production. Every
step that records a value is numbered; copy each value into the deployment
ledger as you go.

> Two open items must be resolved **before** mainnet deploy:
>
> 1. Round-trip-test the `bytes32` form of `NoriTokenBridgeTokenId` against
>    the `tokenIdKeyHash` a real unlock-verification proof will expose (see
>    §3.4 below). No verifier is currently wired in to `unlockTokens`, so
>    this can't be exercised end-to-end yet — revisit once one is.
> 2. Compute `NoriStorageZkappAcctVerificationKeyHash` via a
>    Solidity-equivalent encoder, **not** from `VerificationKey.hash`
>    (Poseidon) — see §6.

---

## 0. Inputs and conventions

| Symbol                    | Meaning                                                |
| ------------------------- | ------------------------------------------------------ |
| `Bridge`, `Admin`, `Base` | The three Mina-side identities                         |
| `Operator`                | The Ethereum SAFE multisig                             |
| `Timelock`                | OZ `TimelockController` instance                       |
| `EthBridge`               | The deployed `NoriTokenBridge.sol` address             |
| 3-of-4                    | Threshold signing scheme — 3 signers required out of 4 |

All Mina addresses are written in Base58. All `bytes32` values are 0x-prefixed
64 hex characters (32 bytes, big-endian).

---

## 1. Generate threshold keys (Mina)

Generate **three** 3-of-4 FROST groups (Schnorr threshold scheme over Pallas,
compatible with Mina signatures):

| Group                | Used for                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Bridge FROST 3/4** | Signs the NoriTokenBridge zkApp deploy transaction; future signatures from the bridge account                                  |
| **Admin FROST 3/4**  | The `adminPublicKey` recorded inside the bridge's state — controls bridge upgrades / admin operations                          |
| **Base FROST 3/4**   | Signs the NoriTokenBase zkApp deploy transaction; retains the ability to re-initialize / re-administer the Base if ever needed |

> ⚠ **Do not broadcast any transaction in this step.** Only key material is
> produced.

### Record

- [ ] `BridgeFROSTGroup` — share holders, public key shares, group public key
- [ ] `AdminFROSTGroup` — share holders, public key shares, group public key
- [ ] `BaseFROSTGroup` — share holders, public key shares, group public key

---

## 2. Derive the addresses

| Variable                 | Source                                      |
| ------------------------ | ------------------------------------------- |
| `NoriTokenBridgeAddress` | Base58 of `BridgeFROSTGroup.groupPublicKey` |
| `NoriTokenAdminAddress`  | Base58 of `AdminFROSTGroup.groupPublicKey`  |
| `NoriTokenBaseAddress`   | Base58 of `BaseFROSTGroup.groupPublicKey`   |

### Record

- [ ] `NoriTokenBridgeAddress`: `B62q...`
- [ ] `NoriTokenAdminAddress`: `B62q...`
- [ ] `NoriTokenBaseAddress`: `B62q...`

---

## 3. Derive the bridge tokenId

The bridge's tokenId is needed on the Ethereum side as the immutable
`NORI_BRIDGE_ZKAPP_ACCT_TOKEN_ID` baked into `NoriTokenBridge.sol` at deploy,
and is also checked against the deployed Mina contract's own `deriveTokenId()`
in §9.3 to confirm the Mina deploy landed on the expected account.

### 3.1. Run the deriver

```bash
cd contracts/mina
npm run derive-token-id -- <NoriTokenBridgeAddress>
```

The script prints both forms and emits the `bytes32` form on a final stdout
line:

```bash
npm run derive-token-id -- <NoriTokenBridgeAddress>
```

### 3.2. Record

- [ ] `NoriTokenBridgeTokenId` (decimal Field): `26360635...`
- [ ] `NoriTokenBridgeTokenIdHex32` (bytes32, big-endian): `0x...`

### 3.3. Cross-checks

The unit test `contracts/mina/src/tests/unit/deriveTokenId.unit.spec.ts` must
pass for the chosen network entry in `contracts/mina/src/env.ts`. If you add a
new network, update `env.ts` first; the parameterized test will catch
inconsistencies.

### 3.4. Open: end-to-end format check

Before mainnet, validate that the big-endian 32-byte form **exactly**
matches the `tokenIdKeyHash` a real unlock-verification proof exposes for
this account, so `NoriTokenBridge.unlockTokens` accepts it. `unlockTokens`
has no verifier wired in yet, so this check has no concrete procedure to
follow until one exists — revisit this section once it does.

---

## 4. Set up the Ethereum SAFE

Set up a 3-of-4 SAFE on the target Ethereum network (mainnet, Sepolia, etc.).

### Record

- [ ] `EthereumNoriTokenBridgeOperatorAddress` (the SAFE): `0x...`

> The SAFE is **not** the bridge operator directly — it becomes the proposer
> and executor of the Timelock in §7. The Timelock is the operator.

---

## 5. Record bridge integrity constants

These are not generated at deploy — they are fixed by the SP1 Helios circuit
and the SP1→PLONK proof-conversion circuit. Pull them from the current build
of those circuits and freeze them.

### Record

- [ ] `noriHeliosProgramPi0` (Field)
- [ ] `proofConversionPO2` (Field)
- [ ] `initialStoreHash` (32-byte hex) — the chosen Ethereum-side block /
      consensus-state snapshot the bridge starts from

---

## 6. Compute the NoriStorageInterface VK hash for the Ethereum contract

The Ethereum-side `NORI_STORAGE_ZKAPP_ACCT_VERIFICATION_KEY_HASH` immutable
is meant to be checked against a `keccak256` hash of the VK an unlock-proof
verifier ABI-decodes on Mina's behalf. `unlockTokens` has no verifier wired
in yet, so nothing currently reads this immutable — it still must be set
correctly at deploy so unlocking isn't blocked once one exists. This is
**not** the same value as Mina's `NoriStorageInterfaceVerificationKey.hash`
(a Poseidon hash over Field elements).

To compute the Ethereum-side hash:

1. Compile `NoriStorageInterface` (`compileAndVerifyContracts` produces the
   `VerificationKey`).
2. Encode it into whatever Solidity struct the unlock verifier's
   `zkapp.verificationKey` decodes to. That struct's shape is currently
   undefined — no verifier is wired in yet — so this step has no concrete
   procedure to follow until one exists.
3. ABI-encode and keccak256 the result.

> **TODO** — add a CLI for this in `contracts/mina/src/bin/`, patterned after
> `deriveTokenId.ts`, so it emits a `bytes32` line for piping into the deploy
> env. Tracked in Appendix B.

### Record

- [ ] `NoriStorageZkappAcctVerificationKeyHash` (bytes32): `0x...`

---

## 7. Deploy `TimelockController` (Ethereum)

Deploy OpenZeppelin `TimelockController` (`contracts/ethereum/contracts/TImeLockController.sol`).

Constructor args:

| Param       | Value                                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| `minDelay`  | Recommended: `172800` (48 hours). Match your security policy.                                                            |
| `proposers` | `[EthereumNoriTokenBridgeOperatorAddress]` — the SAFE                                                                    |
| `executors` | `[EthereumNoriTokenBridgeOperatorAddress]` — the SAFE (or open: `[address(0)]` for permissionless execution after delay) |
| `admin`     | `address(0)` — disable post-deploy admin role; rely on self-administration                                               |

### Record

- [ ] `TimelockAddress`: `0x...`
- [ ] `TimelockMinDelay`: e.g. `172800`

> The Timelock is now self-administered. The SAFE can `schedule(...)` admin
> operations against the bridge; after `minDelay` they become
> executable. Cancellation is also via the SAFE (it has the canceller role).

---

## 8. Deploy the Ethereum contracts

`contracts/ethereum/tasks/deploy.ts` (`npm run deploy`) deploys **two**
Ethereum contracts in a single command and wires them together:

1. `NoriProofRequestQueue` — constructor args: `bridgeOperator`, `feeRecipient`, `proofRequestQueueFeeWei`
2. `NoriTokenBridge`       — uses the address of (1) plus the env values below

After deployment, addresses are written to `.env.nori-eth-token-bridge` and any
optional fee rates are applied via `setLockFeeRate` / `setUnlockFeeRate`.

### Required env

```bash
ETH_NETWORK=<network>

# Deployer
ETH_PRIVATE_KEY=<deployer key>
ETH_RPC_URL=<rpc url>

# Operator → must be the Timelock, not the SAFE
NORI_ETH_BRIDGE_OPERATOR_ADDRESS=<TimelockAddress>

# Mina-side immutables (both required, both validated as 32-byte hex)
NORI_ETH_BRIDGE_ZKAPP_TOKEN_ID=<NoriTokenBridgeTokenIdHex32>
NORI_ETH_BRIDGE_ZKAPP_VERIFICATION_KEY_HASH=<NoriStorageZkappAcctVerificationKeyHash>

# Fee config (initial fee recipient is applied at construction)
NORI_ETH_BRIDGE_FEE_RECIPIENT_ADDRESS=<treasury address or unset>
NORI_ETH_BRIDGE_LOCK_FEE_RATE=<e.g. 500 = 0.5% — optional>
NORI_ETH_BRIDGE_UNLOCK_FEE_RATE=<e.g. 500 = 0.5% — optional>
NORI_ETH_BRIDGE_PROOF_REQUEST_QUEUE_FEE_WEI=<wei, multiple of 1e12 — optional, defaults to 0>
```

> The bridge constructor's 5 params (in order) are
> `(_bridgeOperator, _proofQueueAddr, _zkappAcctTokenId, _zkappAcctVerificationKeyHash, _feeRecipient)`.
> The deploy task wires them up from the env above.

### Run

```bash
cd contracts/ethereum
npm run deploy
```

### Record (also written to `.env.nori-eth-token-bridge`)

- [ ] `NoriProofQueueAddress`: `0x...`
- [ ] `EthereumNoriTokenBridge` (the deployed bridge): `0x...`

The bridge address is what we will pass to the Mina-side
`NoriTokenBridge.deploy({ ethTokenBridgeAddress: ... })`.

### Verify

After deploy:

```bash
cast call <EthereumNoriTokenBridge> "bridgeOperator()(address)"          # == TimelockAddress
cast call <EthereumNoriTokenBridge> "NORI_BRIDGE_ZKAPP_ACCT_TOKEN_ID()(bytes32)"
cast call <EthereumNoriTokenBridge> "NORI_STORAGE_ZKAPP_ACCT_VERIFICATION_KEY_HASH()(bytes32)"
cast call <EthereumNoriTokenBridge> "feeRecipient()(address)"
```

All four must match the recorded values.

---

## 9. Deploy the Mina side (single transaction)

`NoriTokenBridge.deploy(...)`, `NoriTokenBase.deploy(...)`, and
`NoriTokenBase.initialize(...)` are bundled into **one** `Mina.transaction`
block. Two ready-made variants ship in `contracts/mina/src/bin/`:

| Script                                            | Inputs                                                          | Bridge / Base keys                                                                                 | Use when                                                                                   |
| ------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `deploy.ts` (`npm run deploy`)                    | Positional argv (`storeHashHex`, `ethBridgeHex`, `genesisHex`)  | **Generated fresh** at runtime via `PrivateKey.random()`, written to `.env.nori-mina-token-bridge` | Throwaway test deploys where the address can be whatever                                   |
| `deployWithKeys.ts` (`npm run deploy-with-keys`)  | All inputs read from env (no argv); reuses upstream env names    | **Read from env**: `NORI_MINA_TOKEN_BRIDGE_PRIVATE_KEY`, `NORI_MINA_TOKEN_BASE_PRIVATE_KEY`        | The address must match a value derived in §2 (FROST group public keys, fixture keys, etc.) |

Both share the same transaction body and `.env.nori-mina-token-bridge`
output. Use `deployWithKeys.ts` for any deploy where the Bridge / Base
addresses are predetermined; reach for `deploy.ts` only when you genuinely
don't care which addresses you end up with.

### `deploy-with-keys` env layout

The script consumes these env names as-is — sourcing the upstream
`.env.nori-eth-token-bridge` produced by §8 covers most of them:

```bash
# Mina network / deployer (same as `deploy.ts`)
MINA_RPC_NETWORK_URL=<URL>
MINA_NETWORK=<mainnet | testnet | devnet | …>
MINA_SENDER_PRIVATE_KEY=<Base58>          # the deployer / fee payer
MINA_TX_FEE=0.1                           # optional, in MINA

# zkApp account keys (the §2 addresses must match these)
NORI_MINA_TOKEN_BRIDGE_PRIVATE_KEY=<Base58>
NORI_MINA_TOKEN_BASE_PRIVATE_KEY=<Base58>

# Bridge integrity inputs
NORI_INITIAL_STORE_HASH=<32-byte hex>     # §5 — `0x`-prefix tolerated
NORI_ETH_TOKEN_BRIDGE_ADDRESS=<0x…>       # §8 — written to .env.nori-eth-token-bridge
NORI_ETH_PROOF_QUEUE_ADDRESS=<0x…>        # §8 — written to .env.nori-eth-token-bridge

# Optional — defaults to the public key of MINA_SENDER_PRIVATE_KEY
NORI_MINA_TOKEN_BRIDGE_ADMIN=<Base58>     # the §2 NoriTokenAdminAddress
```

> Both scripts sign locally with the keys they hold. With FROST we don't
> have direct access to the Bridge/Base/Admin private keys, so a third
> variant is still required that **builds and proves the transaction but
> does not sign it** — emitting the unsigned tx for the FROST ceremony to
> sign, then a separate step to inject the threshold-produced signatures and
> broadcast.

### 9.1. Build the unsigned transaction (deployer-side)

Run a variant of `contracts/mina/src/bin/deployWithKeys.ts` (which already
sources the Bridge / Base keys from env) that:

1. Compiles + integrity-checks `NoriStorageInterface`, `FungibleToken`, and
   `NoriTokenBridge` (`compileAndVerifyContracts`).
2. Builds the deployment transaction body with the parameters below.
3. Calls `txn.prove()`.
4. **Stops short of signing.** Serialises the transaction (`txn.toJSON()` or
   equivalent) plus the per-account update digests that the FROST groups will
   sign, and writes them to disk for transport to the signers.

Required env: see the §9 *deploy-with-keys env layout* table — the
unsigned-tx variant inherits the same set, just with a different "stop"
point inside the script.

Parameters fed into the transaction:

| Field                               | Value                                                            |
| ----------------------------------- | ---------------------------------------------------------------- |
| `verificationKey`                   | `NoriTokenBridgeVerificationKey` (from compile)                  |
| `adminPublicKey`                    | `NoriTokenAdminAddress` (§2)                                     |
| `tokenBaseAddress`                  | `NoriTokenBaseAddress` (§2)                                      |
| `storageVKHash`                     | `NoriStorageInterfaceVerificationKey.hash` (Poseidon, Mina-side) |
| `newStoreHash`                      | `Bytes32FieldPair.fromBytes32(initialStoreHash)` (§5)            |
| `ethTokenBridgeAddress`             | `EthereumNoriTokenBridge` (§8)                                   |
| `ethProofQueueAddress`              | `NORI_ETH_PROOF_QUEUE_ADDRESS` (§8) — passed as argv[4] to `bin/deploy.ts`, folded to a Field via `Bytes20.fromHex(...).toField()` inside the script |
| `noriHeliosProgramPi0`              | `FrC.from(noriHeliosProgramPi0)` (§5)                            |
| `proofConversionPO2`                | `Field.from(proofConversionPO2)` (§5)                            |
| `tokenBase.deploy.symbol`           | `'nETH'`                                                         |
| `tokenBase.deploy.src`              | `https://github.com/Nori-zk/nori-bridge-sdk`                     |
| `tokenBase.deploy.allowUpdates`     | `true`                                                           |
| `tokenBase.initialize` (positional) | `(NoriTokenBridgeAddress, UInt8.from(6), Bool(false))`           |

`AccountUpdate.fundNewAccount(deployerAccount, 3)` is required.

### 9.2. Sign with FROST

> _TBD — fill in once the FROST signing flow is wired up._

### 9.3. Broadcast and verify

> _TBD — fill in once §9.2 is decided. Once broadcast and included, confirm
> `tokenBridge.deriveTokenId().toString()` equals the `NoriTokenBridgeTokenId`
> recorded in §3, and `tokenBase.deriveTokenId().toString()` equals the
> `NoriTokenBaseTokenId` you'll record below._

### Record

- [ ] Mina deploy tx hash
- [ ] Block height of inclusion
- [ ] Confirmed `NoriTokenBaseTokenId` (decimal Field)
- [ ] Confirmed `NoriTokenBridgeTokenId` matches §3

---

## 10. Post-deploy hardening

1. **Renounce / verify Timelock admin**: confirm `TimelockController.hasRole(DEFAULT_ADMIN_ROLE, <SAFE>)` is `false` and that the contract is self-administered. (If you passed `admin = address(0)` in §7, this is automatic.)
2. **Schedule the SAFE → Timelock workflow on a dry run**: schedule a
   no-op admin call (e.g. set lock fee rate to its current value) through the
   Timelock to confirm the proposer/executor wiring is correct **before** any
   value flows.
3. **Document the Ethereum env outputs**: the deploy task writes
   `.env.nori-eth-token-bridge`. Commit it (without secrets) or store
   alongside the deployment ledger.

---

## 11. Final ledger (fill in)

| Field                                           | Value |
| ----------------------------------------------- | ----- |
| Network (Mina)                                  |       |
| Network (Ethereum)                              |       |
| Deploy date (UTC)                               |       |
| `NoriTokenBridgeAddress`                        |       |
| `NoriTokenBridgeTokenId` (decimal Field)        |       |
| `NoriTokenBridgeTokenId` (bytes32)              |       |
| `NoriTokenAdminAddress`                         |       |
| `NoriTokenBaseAddress`                          |       |
| `NoriTokenBaseTokenId`                          |       |
| `EthereumNoriTokenBridgeOperatorAddress` (SAFE) |       |
| `TimelockAddress`                               |       |
| Timelock `minDelay`                             |       |
| `EthereumNoriTokenBridge`                       |       |
| `NoriStorageZkappAcctVerificationKeyHash`       |       |
| `noriHeliosProgramPi0`                          |       |
| `proofConversionPO2`                            |       |
| `initialStoreHash`                              |       |
| `NORI_ETH_PROOF_QUEUE_ADDRESS`                  |       |
| Initial `feeRecipient`                          |       |
| Initial `lockFeeRate`                           |       |
| Initial `unlockFeeRate`                         |       |
| Mina deploy tx hash                             |       |
| Ethereum bridge deploy tx hash                  |       |

---

## Appendix A — Constructor signature reference

```solidity
// contracts/ethereum/contracts/NoriTokenBridge.sol
constructor(
    address _bridgeOperator,                 // = TimelockAddress (NOT the SAFE directly)
    address _proofQueueAddr,                 // = NoriProofQueueAddress (§8)
    bytes32 _zkappAcctTokenId,               // = NoriTokenBridgeTokenIdHex32  (§3)
    bytes32 _zkappAcctVerificationKeyHash,   // = NoriStorageZkappAcctVerificationKeyHash (§6)
    address _feeRecipient                    // = treasury or address(0) to defer
)
```

## Appendix B — Open tooling gaps

These should be closed before the first mainnet deploy:

- [ ] CLI to compute `NoriStorageZkappAcctVerificationKeyHash` (the Ethereum-format keccak256 hash, not Mina's Poseidon `.hash`).
- [ ] End-to-end fixture test that takes a real unlock-verification proof and asserts `tokenIdKeyHash == TokenId.derive(NoriTokenBridgeAddress)` in the bytes32 form emitted by `deriveTokenId.ts` (closes the TODO in `deriveTokenId.ts`). Blocked until a verifier is wired into `unlockTokens` — see §3.4.
- [ ] Dry-run script that proposes a no-op admin call through the Timelock and exercises the SAFE → Timelock → Bridge path on a testnet before mainnet.
