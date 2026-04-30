# NoriTokenBridge — Production Deployment Runbook

End-to-end procedure to deploy the Mina ↔ Ethereum bridge in production. Every
step that records a value is numbered; copy each value into the deployment
ledger as you go.

> Two open items must be resolved **before** mainnet deploy:
>
> 1. Round-trip-test the `bytes32` form of `NoriTokenBridgeTokenId` against an
>    AlignedLayer-produced `account.tokenIdKeyHash` (see §3.4 below).
> 2. Compute `NoriStorageZkappAcctVerificationKeyHash` via the
>    Solidity-equivalent encoder, **not** from `VerificationKey.hash` (Poseidon)
>    — see §6.

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
`NORI_BRIDE_ZKAPP_ACCT_TOKEN_ID` baked into `NoriTokenBridge.sol` at deploy.

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

Before mainnet, validate that the big-endian 32-byte form **exactly** matches
`account.tokenIdKeyHash` as ABI-decoded from a real AlignedLayer pubInput.
There is a TODO in `deriveTokenId.ts` flagging this; the bridge will revert
with `IncorrectTokenHolderAccount` if the bytes don't match. The
recommended check: replay a known-good Mina account through
`MinaAccountValidation.validateAccount(...)` on a fork and assert
`tokenIdKeyHash == NoriTokenBridgeTokenIdHex32`.

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

The Ethereum-side `NORI_STORAGE_ZKAPP_ACCT_VERIFICATION_KEY_HASH` immutable is
compared against `keccak256(abi.encode(account.zkapp.verificationKey))` inside
`unlockTokens`, where the VK comes ABI-decoded from the AlignedLayer
pubInput. This is **not** the same value as Mina's
`NoriStorageInterfaceVerificationKey.hash` (a Poseidon hash over Field
elements).

To compute the Ethereum-side hash:

1. Compile `NoriStorageInterface` (`compileAndVerifyContracts` produces the
   `VerificationKey`).
2. Encode it into the same Solidity struct that
   `MinaAccountValidation.Account.zkapp.verificationKey` decodes to (mirroring
   the AlignedLayer Rust encoder).
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

## 8. Run the Ethereum pre-deploy step

`bin/preDeploy.ts` (`npm run pre-deploy`) fetches the two network-dependent
values that aren't produced by the deploy itself and writes them to
`.env.nori-eth-pre-deploy`:

| Output                                | Source                                                                          | Used by                              |
| ------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------ |
| `ALIGNED_ETH_SERVICE_MANAGER_ADDRESS` | `aligned_layer` repo's `alignedlayer_deployment_output.json` for `ETH_NETWORK`  | §9 Ethereum deploy                   |
| `NORI_ETH_GENESIS_ROOT`               | `eth/v1/beacon/genesis` on `ETH_CONSENSUS_RPC` (`genesis_validators_root` field) | §10 Mina-side deploy (positional arg) |

### Required env

```bash
ETH_NETWORK=<network>           # one of: hardhat, sepolia, hoodi, mainnet
ETH_CONSENSUS_RPC=<beacon URL>  # consensus-layer RPC for the same network
```

### Run

```bash
cd contracts/ethereum
npm run pre-deploy
cat .env.nori-eth-pre-deploy >> .env   # fold the values into your .env for §9
```

### Record (also written to `.env.nori-eth-pre-deploy`)

- [ ] `ALIGNED_ETH_SERVICE_MANAGER_ADDRESS`: `0x...`
- [ ] `NORI_ETH_GENESIS_ROOT`: `0x...` (32-byte hex; consumed by §10)

---

## 9. Deploy the Ethereum contracts

`contracts/ethereum/tasks/deploy.ts` (`npm run deploy`) deploys **all three**
Ethereum contracts in a single command and wires them together:

1. `MinaAccountValidation` — constructor arg: `ALIGNED_ETH_SERVICE_MANAGER_ADDRESS`
2. `MinaStateSettlement`   — constructor args: `ALIGNED_ETH_SERVICE_MANAGER_ADDRESS`, `devnetFlag` (auto-set from `ETH_NETWORK`)
3. `NoriTokenBridge`       — uses the addresses of (1) and (2) plus the env values below

After deployment, addresses are written to `.env.nori-eth-token-bridge` and any
optional fee rates are applied via `setLockFeeRate` / `setUnlockFeeRate`.

### Required env

```bash
# From §8 pre-deploy
ALIGNED_ETH_SERVICE_MANAGER_ADDRESS=0x...
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
```

> The bridge constructor's 6 params (in order) are
> `(_bridgeOperator, _stateSettlementAddr, _accountValidationAddr, _zkappAcctTokenId, _zkappAcctVerificationKeyHash, _feeRecipient)`.
> The deploy task wires them up from the env above.

### Run

```bash
cd contracts/ethereum
npm run deploy
```

### Record (also written to `.env.nori-eth-token-bridge`)

- [ ] `MinaAccountValidationAddress`: `0x...`
- [ ] `MinaStateSettlementAddress`: `0x...`
- [ ] `EthereumNoriTokenBridge` (the deployed bridge): `0x...`

The bridge address is what we will pass to the Mina-side
`NoriTokenBridge.deploy({ ethTokenBridgeAddress: ... })`.

### Verify

After deploy:

```bash
cast call <EthereumNoriTokenBridge> "bridgeOperator()(address)"          # == TimelockAddress
cast call <EthereumNoriTokenBridge> "NORI_BRIDE_ZKAPP_ACCT_TOKEN_ID()(bytes32)"
cast call <EthereumNoriTokenBridge> "NORI_STORAGE_ZKAPP_ACCT_VERIFICATION_KEY_HASH()(bytes32)"
cast call <EthereumNoriTokenBridge> "feeRecipient()(address)"
```

All four must match the recorded values.

---

## 10. Deploy the Mina side (single transaction)

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

The script consumes these env names as-is — sourcing the upstream `.env.*`
files produced by §8 (`.env.nori-eth-pre-deploy`) and §9
(`.env.nori-eth-token-bridge`) covers most of them:

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
NORI_ETH_TOKEN_BRIDGE_ADDRESS=<0x…>       # §9 — written to .env.nori-eth-token-bridge
NORI_ETH_GENESIS_ROOT=<0x…>               # §8 — written to .env.nori-eth-pre-deploy

# Optional — defaults to the public key of MINA_SENDER_PRIVATE_KEY
NORI_MINA_TOKEN_BRIDGE_ADMIN=<Base58>     # the §2 NoriTokenAdminAddress
```

> Both scripts sign locally with the keys they hold. With FROST we don't
> have direct access to the Bridge/Base/Admin private keys, so a third
> variant is still required that **builds and proves the transaction but
> does not sign it** — emitting the unsigned tx for the FROST ceremony to
> sign, then a separate step to inject the threshold-produced signatures and
> broadcast.

### 10.1. Build the unsigned transaction (deployer-side)

Run a variant of `contracts/mina/src/bin/deployWithKeys.ts` (which already
sources the Bridge / Base keys from env) that:

1. Compiles + integrity-checks `NoriStorageInterface`, `FungibleToken`, and
   `NoriTokenBridge` (`compileAndVerifyContracts`).
2. Builds the deployment transaction body with the parameters below.
3. Calls `txn.prove()`.
4. **Stops short of signing.** Serialises the transaction (`txn.toJSON()` or
   equivalent) plus the per-account update digests that the FROST groups will
   sign, and writes them to disk for transport to the signers.

Required env: see the §10 *deploy-with-keys env layout* table — the
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
| `ethTokenBridgeAddress`             | `EthereumNoriTokenBridge` (§9)                                   |
| `noriHeliosProgramPi0`              | `FrC.from(noriHeliosProgramPi0)` (§5)                            |
| `proofConversionPO2`                | `Field.from(proofConversionPO2)` (§5)                            |
| `genesisRoot`                       | `NORI_ETH_GENESIS_ROOT` (§8) — passed as argv[4] to `bin/deploy.ts`, hashed via Poseidon over `Bytes32.fromHex(...).toFields()` inside the script |
| `tokenBase.deploy.symbol`           | `'nETH'`                                                         |
| `tokenBase.deploy.src`              | `https://github.com/Nori-zk/nori-bridge-sdk`                     |
| `tokenBase.deploy.allowUpdates`     | `true`                                                           |
| `tokenBase.initialize` (positional) | `(NoriTokenBridgeAddress, UInt8.from(6), Bool(false))`           |

`AccountUpdate.fundNewAccount(deployerAccount, 3)` is required.

### 10.2. Sign with FROST

> _TBD — fill in once the FROST signing flow is wired up._

### 10.3. Broadcast and verify

> _TBD — fill in once §10.2 is decided. Once broadcast and included, confirm
> `tokenBridge.deriveTokenId().toString()` equals the `NoriTokenBridgeTokenId`
> recorded in §3, and `tokenBase.deriveTokenId().toString()` equals the
> `NoriTokenBaseTokenId` you'll record below._

### Record

- [ ] Mina deploy tx hash
- [ ] Block height of inclusion
- [ ] Confirmed `NoriTokenBaseTokenId` (decimal Field)
- [ ] Confirmed `NoriTokenBridgeTokenId` matches §3

---

## 11. Post-deploy hardening

1. **Renounce / verify Timelock admin**: confirm `TimelockController.hasRole(DEFAULT_ADMIN_ROLE, <SAFE>)` is `false` and that the contract is self-administered. (If you passed `admin = address(0)` in §7, this is automatic.)
2. **Schedule the SAFE → Timelock workflow on a dry run**: schedule a
   no-op admin call (e.g. set lock fee rate to its current value) through the
   Timelock to confirm the proposer/executor wiring is correct **before** any
   value flows.
3. **Document the Ethereum env outputs**: the deploy task writes
   `.env.nori-eth-token-bridge`. Commit it (without secrets) or store
   alongside the deployment ledger.

---

## 12. Final ledger (fill in)

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
| `MinaStateSettlementAddress`                    |       |
| `MinaAccountValidationAddress`                  |       |
| `EthereumNoriTokenBridge`                       |       |
| `NoriStorageZkappAcctVerificationKeyHash`       |       |
| `noriHeliosProgramPi0`                          |       |
| `proofConversionPO2`                            |       |
| `initialStoreHash`                              |       |
| `NORI_ETH_GENESIS_ROOT`                         |       |
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
    address _stateSettlementAddr,            // = MinaStateSettlementAddress
    address _accountValidationAddr,          // = MinaAccountValidationAddress
    bytes32 _zkappAcctTokenId,               // = NoriTokenBridgeTokenIdHex32  (§3)
    bytes32 _zkappAcctVerificationKeyHash,   // = NoriStorageZkappAcctVerificationKeyHash (§6)
    address _feeRecipient                    // = treasury or address(0) to defer
)
```

## Appendix B — Open tooling gaps

These should be closed before the first mainnet deploy:

- [ ] CLI to compute `NoriStorageZkappAcctVerificationKeyHash` (the Ethereum-format keccak256 hash, not Mina's Poseidon `.hash`).
- [ ] End-to-end fixture test that takes a real AlignedLayer pubInput and asserts `account.tokenIdKeyHash == TokenId.derive(NoriTokenBridgeAddress)` in the bytes32 form emitted by `deriveTokenId.ts` (closes the TODO in `deriveTokenId.ts`).
- [ ] Dry-run script that proposes a no-op admin call through the Timelock and exercises the SAFE → Timelock → Bridge path on a testnet before mainnet.
