# Changelog

## 24/4/26 -- Genesis Root in Public Outputs

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
