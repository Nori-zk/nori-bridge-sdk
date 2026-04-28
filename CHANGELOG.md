# Changelog

## 27/4/26

### Ethereum Constructor Hardening and TimelockController

- **`TimelockController.sol`** (`contracts/ethereum/contracts/TImeLockController.sol`): OpenZeppelin v5.6 TimelockController added for future governance timelocking of admin operations
- **Ethereum `NoriTokenBridge` constructor** (`contracts/ethereum/contracts/NoriTokenBridge.sol`): now accepts `_zkappAcctTokenId`, `_zkappAcctVerificationKeyHash`, and `_feeRecipient`. Previously hard-coded TODO placeholders replaced with `immutable` fields set at deployment
- **Deploy task** (`contracts/ethereum/tasks/deploy.ts`): updated to pass new constructor args
- **Hardhat tests** (`contracts/ethereum/test/NoriTokenBridge.ts`): updated all `deploy()` calls, added tests for immutable tokenId, vkHash, and feeRecipient constructor behaviour
- **Stale TODOs removed** from `setAlignedContracts`, `deposit`, and `setBridgeOperator`

### deriveTokenId CLI Script

- **`deriveTokenId` CLI script** (`contracts/mina/src/bin/deriveTokenId.ts`): derives the Mina tokenId for a given public key via `TokenId.derive`, useful for pre-deploy parameter computation
- **Unit tests** (`contracts/mina/src/tests/unit/deriveTokenId.unit.spec.ts`)

### Deployment Document WIP

- **`contracts/DEPLOYMENT.md`** added with deployment procedure documentation (work in progress)

### Immutable zkApp Constants Reordered

- **`NoriTokenBridge.sol`**: `NORI_STORAGE_ZKAPP_ACCT_VERIFICATION_KEY_HASH` and `NORI_BRIDE_ZKAPP_ACCT_TOKEN_ID` moved below custom errors and state variables for Solidity storage layout clarity

### Genesis Root On-Chain State and Deploy Wiring

- **`@state(Field) genesisRoot` on `NoriTokenBridge`** (`contracts/mina/src/NoriTokenBridge.ts`): Poseidon-hashed immutable on-chain anchor set at deploy. `update()` asserts the proof genesis validators root matches, rejecting proofs from a different Ethereum chain. No admin setter exists by design
- **`extractGenesisRootFromSP1Proof` helper** (`o1js-zk-utils/src/utils.ts`): decodes the genesis root from an SP1 proof and returns its Poseidon hash
- **`NORI_ETH_GENESIS_ROOT`** added to staging config (`contracts/mina/src/env.ts`) and `Env` type
- **`genesisRoot` wired through deploy pipeline**: deploy CLI accepts it as 4th positional arg, `NoriTokenControllerDeployProps` extended, `proofSubmitter`, `tokenBridgeTester` worker, and all integration/e2e test deploy calls updated
- **`ethVerify` return type** now returns both `ethGenesisRootBytes` and `ethTokenBridgeAddressBytes`
- **`NoriTokenBridge.VkData.json` and `NoriTokenBridge.VkHash.json`** updated after genesis root state addition
- **`pre-deploy.ts` removed** (renamed `preDeploy.ts` in previous entry); `package.json` script path fixed
- **Ethereum README** updated with `ETH_CONSENSUS_RPC` and genesis root documentation for pre-deploy

### Test Example Proofs on o1js 3.0.0-mesa.698

- **Test example proof series replaced**: 10102688--10102912 replaced with 10131744--10131840 with new proofs, p0 data, sp1Proof data, nodeVk, and index/type files generated under o1js `3.0.0-mesa.698`
- **`sp1-mpt-proof` test data replaced**: `10102688-v6.1.0.json` replaced with `10131744-v6.1.0.json` in both `contracts/mina` and `o1js-zk-utils`
- **Primary proof data** (`proofs/p0.json`, `proofs/sp1Proof.json`): refreshed for mesa.698

### Ethereum Artifact Rebuild

- **Ethereum contract artifacts rebuilt** (`MinaAccountValidation.json`, `MinaStateSettlement.json`, `NoriTokenBridge.json`, `TimelockController.json`, `NoriTokenBridge__factory.ts`): regenerated after constructor and immutable-field changes

### VkData Updated

- **`NoriTokenBridge.VkData.json` and `NoriTokenBridge.VkHash.json`** updated to match current verification keys after genesis root state addition and mesa.698 recompilation

## 24/4/26

### Mina NoriTokenBridge Permissions Hardened

- **`NoriTokenBridge` permissions** (`contracts/mina/src/NoriTokenBridge.ts`): `access` permission set to `Permissions.proof()`, `canChangeAdmin` now returns `Bool(false)`
- **Import consolidation**: `VerificationKey` and `AccountUpdateForest` moved into main `o1js` import, duplicate import blocks for `depositAttestation.js` merged
- **`updateVerificationKey` docstring** expanded to note it is required if proof-conversion vk changes or `EthInput` type changes
- **`updateStoreHash` comment** added noting it is needed in case Helios changes its store structure
- **`adminSetDepositRoot` docstring** marked with `@TODO` for future removal

### Genesis Root in Public Outputs

### Changed

- **Proof public output layout extended**: added `genesisRoot` (Bytes32) at offset 196, total proof length increased from 196 to 228 bytes -- every state transition is now cryptographically bound to the Ethereum chain it was generated against
- **`EthInput` struct** (`o1js-zk-utils/src/ethVerifier.ts`): added `genesisRoot: Bytes32.provable` field and appended it to the byte-commitment concatenation
- **`NoriTokenBridge`** (`contracts/mina/src/NoriTokenBridge.ts`): appended `input.genesisRoot.bytes` to the commitment hash check
- **`decodeConsensusMptProof`** (`o1js-zk-utils/src/utils.ts`): updated `proofOffsets` and slicing logic to extract `genesisRoot` from proof data
- **`pre-deploy.ts` renamed to `preDeploy.ts`** (`contracts/ethereum/bin`): renamed for consistency, refactored error handling from `process.exit` to thrown errors wrapped in a top-level catch, and added `fetchGenesisValidatorsRoot` which queries the beacon chain consensus API and writes `NORI_ETH_GENESIS_ROOT` to `.env.nori-eth-pre-deploy`
- **`slot_nested_key_attestation_hash` renamed to `slot_key_code_challenge`** across test data and specs to match updated contract storage slot schema
- **`@nori-zk/pts-types` upgraded from `5.0.0` to `6.0.1`** across all workspaces (`contracts/mina`, `o1js-zk-utils`, `minimal-client`)
- **Test example series replaced**: 10080800--10080896 to 10102688--10102912 with proofs generated under the new ZK program that includes genesis root in its public outputs
- **`sp1ProofMessage.ts`** simplified in both `contracts/mina` and `o1js-zk-utils` -- removed inline type definition in favour of spread + cast from JSON import
- **Integrity hashes and pi0 updated** (`NoriTokenBridge.VkHash.json`, `NoriTokenBridge.VkData.json`, `EthVerifier.VkHash.json`, `nori-sp1-helios-program.pi0.json`) to match the updated ZK program with genesis root in public outputs
