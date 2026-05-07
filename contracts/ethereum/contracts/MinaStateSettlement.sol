// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import '@aligned_layer/contracts/src/core/AlignedLayerServiceManager.sol';

error MinaProvingSystemIdIsNotValid(bytes32);
error MinaNetworkIsWrong();
error NewStateIsNotValid();

/// @title Mina to Ethereum Bridge — Accumulative State Settlement
///
/// @notice Verifies Mina Proofs of State via Aligned Layer and accumulates verified
///         finalized ledger hashes. Each proof adds one finalized ledger hash (index 0
///         of the 16-block transition frontier — the block with 15 confirmations).
///         Proofs are independent: concurrent submissions cannot invalidate each other.
///
/// @dev Design change from lambdaclass reference implementation:
///
///      The reference contract (MinaStateSettlementExample.sol) stores a fixed 16-element
///      array that gets OVERWRITTEN on every updateChain call, and enforces tip-chaining
///      (new proof's bridge_tip_state_hash must match the previously stored tip at index 15).
///
///      Tip-chaining creates two critical failure modes:
///
///        1. REORG BRICKING — The stored tip (index 15) is the NEWEST block in the frontier
///           (depth 0). If that block gets reorged on Mina (common at depth 1), its full
///           state data may be pruned from Mina nodes. The next proof REQUIRES that state
///           data (the Aligned operator checks hash(proof.bridge_tip_state) == pubInput.
///           bridge_tip_state_hash, and the contract checks pubInput.bridge_tip_state_hash
///           == chainStateHashes[15]). Without the data, no valid proof can be constructed.
///           The bridge is permanently bricked — not by an attacker, by normal Mina operation.
///
///        2. GRIEFING — updateChain is permissionless. Any user submitting a valid proof
///           changes the on-chain tip, instantly invalidating all in-flight proofs from
///           other relayers (which reference the old tip).
///
///      This contract eliminates both issues:
///        - No tip-chaining → each proof stands alone, no dependency on previous on-chain state
///        - Mapping accumulation → one proof cannot overwrite or invalidate another
///        - Only index 0 (15 blocks deep) is stored → reorg-resistant by Mina's own finality
///
///      Security model:
///        - Pickles recursive proof: the submitted chain of 16 blocks is internally valid
///        - Aligned operator verification: proof was checked (consensus + Pickles + pub input integrity)
///        - Mina consensus security: forking 16+ blocks requires majority stake (≈ 51% attack)
///
///      NOTE on the Aligned operator's consensus check:
///        The operator still runs select_secure_chain(candidate_tip, bridge_tip) internally.
///        The bridge_tip_state_hash remains in pubInput (it's part of the proof format used by
///        the operator). We simply don't anchor it to on-chain state. The proof generator can
///        use any bridge_tip — the operator just needs the candidate to be "better" per Samasika.
///        There is a known bug in the operator's consensus_state.rs where both tip_density and
///        candidate_density are computed from the candidate (identical call args), making the
///        long-range fork rule a no-op. In practice, the check reduces to: candidate has higher
///        blockchain_length. This is sufficient because producing a longer chain requires stake.
contract MinaStateSettlement {
    /// @notice The commitment to Mina state proving system ID (verified by Aligned operators).
    /// potentially find a way to get rid of this - confimred by algined team
    bytes32 constant PROVING_SYSTEM_ID_COMM =
        0xd0591206d9e81e07f4defc5327957173572bcd1bca7838caa7be39b0c12b1873;

    /// @notice Length of the transition frontier in each proof (16 blocks).
    /// Index 0 = oldest block (15 confirmations, "finalized").
    /// Index 15 = newest block (tip, 0 confirmations).
    /// Only the finalized ledger hash at index 0 is stored.
    uint256 public constant BRIDGE_TRANSITION_FRONTIER_LEN = 16;

    /// @notice Whether this settlement instance targets Mina devnet (true) or mainnet (false).
    bool public immutable devnetFlag;

    /// @notice Reference to the Aligned Layer service manager for batch inclusion verification.
    AlignedLayerServiceManager public immutable aligned;

    /// @notice Accumulated set of verified finalized ledger hashes.
    /// Once set to true, a hash remains true permanently — entries are never removed.
    /// Downstream contracts (e.g. NoriTokenBridge) call isLedgerVerified() to check
    /// whether an account proof's ledger hash has been verified through a state proof.
    mapping(bytes32 => bool) public verifiedLedgerHashes;

    /// @notice Emitted when a new finalized ledger hash is verified and stored.
    /// @param ledgerHash The snarked ledger hash at index 0 of the verified transition frontier.
    event LedgerHashVerified(bytes32 indexed ledgerHash);

    /// @param _alignedServiceAddr The Aligned Layer service manager contract address.
    /// @param _devnetFlag True for Mina devnet, false for mainnet.
    constructor(address payable _alignedServiceAddr, bool _devnetFlag) {
        aligned = AlignedLayerServiceManager(_alignedServiceAddr);
        devnetFlag = _devnetFlag;
        // No _tipStateHash needed — there is no tip-chaining to bootstrap.
    }

    /// @notice Check if a snarked ledger hash has been verified by a Mina Proof of State.
    /// @param ledgerHash The snarked ledger hash to check.
    /// @return True if this ledger hash was verified as the finalized block (index 0)
    ///         of at least one valid transition frontier proof.
    function isLedgerVerified(bytes32 ledgerHash) external view returns (bool) {
        return verifiedLedgerHashes[ledgerHash];
    }

    /// @notice Submit a Mina Proof of State (verified by Aligned) to register a new
    ///         finalized ledger hash. Permissionless — anyone can call this.
    ///
    /// @dev pubInput layout (bytes, produced by mina_bridge_core serialization):
    ///
    ///      Data offset  | Size      | Field
    ///      -------------|-----------|----------------------------------------------
    ///      0            | 1 byte    | devnet flag
    ///      1            | 32 bytes  | bridge_tip_state_hash (operator-only, not checked on-chain)
    ///      33           | 512 bytes | candidate_chain_state_hashes[16]  (16 × 32)
    ///      545          | 512 bytes | candidate_chain_ledger_hashes[16] (16 × 32)
    ///
    ///      Memory offset for finalized ledger hash (index 0):
    ///        32 (bytes memory length prefix)
    ///      +  1 (devnet flag)
    ///      + 32 (bridge_tip_state_hash)
    ///      + 512 (16 state hashes)
    ///      = 577 = 0x241
    ///
    ///      The keccak256(pubInput) commitment verified by Aligned's verifyBatchInclusion
    ///      ensures pubInput integrity — if the data is malformed or truncated, the hash
    ///      won't match and verification fails.
    function updateChain(
        bytes32 proofCommitment,
        bytes32 provingSystemAuxDataCommitment,
        bytes20 proofGeneratorAddr,
        bytes32 batchMerkleRoot,
        bytes memory merkleProof,
        uint256 verificationDataBatchIndex,
        bytes memory pubInput,
        address batcherPaymentService
    ) external {
        // 1. Verify the proof was generated by the Mina state proving system
        if (provingSystemAuxDataCommitment != PROVING_SYSTEM_ID_COMM) {
            revert MinaProvingSystemIdIsNotValid(
                provingSystemAuxDataCommitment
            );
        }

        // 2. Verify the proof targets the correct Mina network
        if ((pubInput[0] == 0x01) != devnetFlag) {
            revert MinaNetworkIsWrong();
        }

        // NOTE: No tip-chaining check. See contract-level @dev documentation for rationale.
        // The reference implementation checks:
        //   require(pubInput.bridge_tip_state_hash == chainStateHashes[15])
        // This is intentionally omitted to prevent reorg bricking and griefing attacks.

        // 3. Verify the proof was included and verified in an Aligned batch.
        //    verifyBatchInclusion checks keccak256(pubInput) against the committed
        //    public input hash, ensuring the data we read from pubInput below is
        //    exactly what the Aligned operators verified.
        bytes32 pubInputCommitment = keccak256(pubInput);

        bool verified = aligned.verifyBatchInclusion(
            proofCommitment,
            pubInputCommitment,
            provingSystemAuxDataCommitment,
            proofGeneratorAddr,
            batchMerkleRoot,
            merkleProof,
            verificationDataBatchIndex,
            batcherPaymentService
        );
        if (!verified) revert NewStateIsNotValid();

        // 4. Extract the finalized ledger hash (index 0 of candidate_chain_ledger_hashes).
        //    Index 0 is the oldest block in the 16-block frontier, with 15 blocks
        //    confirming it. We treat this as finalized — a reorg deep enough to
        //    affect it (16+ blocks) would require majority Mina stake.
        //
        //    Offset derivation (verified against reference implementation assembly):
        //      addr_states  = pubInput + 65          [reference: add(pubInput, 65)]
        //      addr_ledgers = addr_states + 16 × 32  [reference: add(addr_states, mul(32, 16))]
        //                   = 65 + 512 = 577 = 0x241
        bytes32 finalizedLedgerHash;
        assembly {
            finalizedLedgerHash := mload(add(pubInput, 0x241))
        }

        // 5. Accumulate in mapping. Idempotent: re-submitting the same proof is a no-op
        //    (costs gas but doesn't affect state). Different proofs from different relayers
        //    add different hashes without conflict — this is the key property that prevents
        //    griefing via front-running.
        verifiedLedgerHashes[finalizedLedgerHash] = true;
        emit LedgerHashVerified(finalizedLedgerHash);
    }
}
