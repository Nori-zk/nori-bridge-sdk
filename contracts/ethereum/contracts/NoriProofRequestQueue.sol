// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

/// @title NoriProofRequestQueue
/// @notice Append-only, on-chain buffer of storage-proof requests, consumed in
///         order by the Nori SP1 consensus + MPT program. Any contract may
///         enqueue a proof of ITS OWN storage — `target` is always
///         `msg.sender` — by paying `proofRequestQueueFee` per request.
/// @dev STORAGE LAYOUT IS CONSENSUS-CRITICAL.
///
///      The SP1 guest program derives storage keys from the layout below and
///      verifies the words it reads by Merkle-Patricia proof against the
///      Ethereum execution state root. Reordering the declarations,
///      inheriting a contract that itself declares storage (OpenZeppelin
///      `ReentrancyGuard` would claim slot 0 — this is precisely why
///      `NoriTokenBridge.lockedTokens` sits at slot 2), or deploying behind
///      an upgradeable proxy all silently invalidate every proof.
///
///        slot 0  : head          <- provable, read by the circuit
///        slot 1  : _requests     <- provable, read by the circuit
///        slot 2+ : configuration <- not provable, free to evolve
///
///      Entry `i` occupies five consecutive words starting at
///      `keccak256(abi.encode(i, uint256(1)))`:
///
///        +0  target                +3  collectionKeys[0]
///        +1  slotKey               +4  collectionKeys[1]
///        +2  collectionKeysCount
///
///      Every field deliberately gets a whole word. Bit-packing would save
///      gas but would have to be respecified and tested identically in
///      Solidity, the Rust circuit and the TypeScript tooling; the extra
///      storage cost is carried by `proofRequestQueueFee`.
///
///      Governance mirrors NoriTokenBridge: in production `operator` is
///      expected to be the same OpenZeppelin TimelockController (deployed via
///      tasks/deployTimelock.ts) whose proposer role is held by a Safe
///      multisig. Admin actions therefore flow as: Safe -> propose ->
///      Timelock (delay) -> queue admin call. This contract implements no
///      timelock logic internally, and holds no reentrancy guard by design
///      (see the storage note above); `withdrawFees` follows CEI instead.
contract NoriProofRequestQueue {
    // -------------------------------
    // Constants
    // -------------------------------
    /// @notice Maximum number of collection keys carried by a single request.
    /// @dev Consensus-critical: the circuit's leaf hash has one input per key.
    uint8 public constant MAX_COLLECTION_KEYS = 2;
    /// @notice Fees must be whole multiples of 10^12 wei (0.000001 ETH).
    /// @dev NoriTokenBridge denominates value in bridge units of exactly
    ///      10^12 wei, so an aligned fee folds into its fee schedule without
    ///      rounding. Consumers with coarser units are unaffected.
    uint256 public constant PROOF_REQUEST_QUEUE_FEE_GRANULARITY_WEI = 10 ** 12;
    /// @notice Hard ceiling on the fee; governance cannot exceed it.
    /// @dev Mirrors NoriTokenBridge.MAX_FEE_RATE — an immutable bound on what
    ///      a compromised or mistaken operator can charge. Deliberately far
    ///      above any expected fee (the marginal cost of one more leaf in a
    ///      batch proof is small enough that this contract's own storage gas
    ///      dominates it), so an extreme gas or ETH-price move never requires
    ///      redeploying to keep proving economic.
    ///
    ///      That headroom means the ceiling sits ABOVE
    ///      NoriTokenBridge.MIN_LOCK_AMOUNT_WEI: a fee set anywhere near it
    ///      would make small deposits revert with `FeeExceedsLockAmount`.
    ///      Keeping the live fee well below the bridge's minimum deposit is an
    ///      operational responsibility, not something this bound enforces.
    uint256 public constant MAX_PROOF_REQUEST_QUEUE_FEE = 0.05 ether;

    // -------------------------------
    // Custom Errors
    // -------------------------------
    error ZeroAddress();
    error NotOperator();
    error NotFeeRecipient();
    error FeeRecipientNotSet();
    error NoFeesToWithdraw();
    error InsufficientFee();
    error TooManyCollectionKeys();
    error ProofRequestQueueFeeTooHigh();
    error ProofRequestQueueFeeNotAligned();
    error EthTransferFailed();

    // -------------------------------
    // Provable State (consensus-critical layout — do not reorder)
    // -------------------------------
    /// @notice Total requests ever enqueued; also the id of the next request.
    /// @dev Slot 0. Monotonic, never decremented. The circuit MPT-proves this
    ///      value and derives its batch size as `head - cursor`, so the
    ///      prover has no discretion over which requests an update covers.
    uint256 public head;

    /// @notice Request id => request record. Append-only: written once at
    ///         enqueue time, never edited and never deleted, so any entry
    ///         stays provable at every later block.
    /// @dev Slot 1. Internal because Solidity's auto-generated getter would
    ///      omit the fixed-array member; use `requests(i)` instead.
    mapping(uint256 => Request) internal _requests;

    // -------------------------------
    // Configuration State (not provable — slot 2 onwards)
    // -------------------------------
    /// @notice Fee charged per enqueued request, in wei.
    uint256 public proofRequestQueueFee;
    /// @notice Admin address; expected to be a Timelock fronted by a Safe.
    address public operator;
    /// @notice Treasury address permitted to withdraw accumulated fees.
    address public feeRecipient;
    /// @notice Fees collected and not yet withdrawn, in wei.
    uint256 public accumulatedFees;

    // -------------------------------
    // Types
    // -------------------------------
    /// @param target The contract whose storage is to be proven — always the
    ///        enqueuer. Rides into the proven leaf so consumers can be told
    ///        apart, and so a leaf can never be replayed against a different
    ///        consumer's Mina-side counterpart.
    /// @param slotKey The raw storage key handed to `eth_getProof`. Opaque to
    ///        the circuit: the requester resolves its own layout (mapping
    ///        hashes, array offsets, nested paths) before enqueueing, so any
    ///        storage shape is supported.
    /// @param collectionKeysCount How many of `collectionKeys` are in use.
    ///        Distinguishes "one key" from "two keys of which the second is
    ///        zero"; unused entries stay zero.
    /// @param collectionKeys The keys locating the value inside its
    ///        collection — a mapping key, an array index, or both for a
    ///        nested mapping. Relayed into the leaf without interpretation so
    ///        the consumer's counterpart can identify what was proven.
    struct Request {
        address target;
        bytes32 slotKey;
        uint8 collectionKeysCount;
        bytes32[MAX_COLLECTION_KEYS] collectionKeys;
    }

    // -------------------------------
    // Events
    // -------------------------------
    event ProofRequested(
        uint256 indexed requestId,
        address indexed target,
        bytes32 slotKey,
        bytes32[] collectionKeys
    );
    event ProofRequestQueueFeeSet(uint256 oldFee, uint256 newFee);
    event OperatorSet(address indexed oldOperator, address indexed newOperator);
    event FeeRecipientSet(
        address indexed oldRecipient,
        address indexed newRecipient
    );
    event FeesWithdrawn(address indexed recipient, uint256 amount);

    // -------------------------------
    // Modifiers
    // -------------------------------
    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    // -------------------------------
    // Constructor
    // -------------------------------
    /// @param _operator Admin address (expected to be a Timelock in production).
    /// @param _feeRecipient Treasury address that may withdraw fees. Pass
    ///        `address(0)` to defer; configure later via `setFeeRecipient`.
    /// @param _proofRequestQueueFee Initial per-request fee in wei. Must not
    ///        exceed `MAX_PROOF_REQUEST_QUEUE_FEE` and must be a multiple of
    ///        `PROOF_REQUEST_QUEUE_FEE_GRANULARITY_WEI`, exactly as
    ///        `setProofRequestQueueFee` requires.
    constructor(
        address _operator,
        address _feeRecipient,
        uint256 _proofRequestQueueFee
    ) {
        if (_operator == address(0)) revert ZeroAddress();
        if (_proofRequestQueueFee > MAX_PROOF_REQUEST_QUEUE_FEE)
            revert ProofRequestQueueFeeTooHigh();
        if (_proofRequestQueueFee % PROOF_REQUEST_QUEUE_FEE_GRANULARITY_WEI != 0)
            revert ProofRequestQueueFeeNotAligned();

        operator = _operator;
        emit OperatorSet(address(0), _operator);

        if (_feeRecipient != address(0)) {
            feeRecipient = _feeRecipient;
            emit FeeRecipientSet(address(0), _feeRecipient);
        }

        if (_proofRequestQueueFee != 0) {
            proofRequestQueueFee = _proofRequestQueueFee;
            emit ProofRequestQueueFeeSet(0, _proofRequestQueueFee);
        }
    }

    // -------------------------------
    // Enqueue a proof request
    // -------------------------------
    /// @notice Enqueue a request to prove one storage slot of the CALLER's
    ///         own storage alongside the next consensus proof.
    /// @dev `target` is `msg.sender` by construction: a contract can only
    ///      request proofs of its own state. That is what makes the
    ///      (`slotKey`, `collectionKeys`) pairing the caller's responsibility
    ///      and unforgeable by third parties — the circuit relays both
    ///      verbatim and cannot validate them against an arbitrary contract's
    ///      storage layout. A caller that pairs them inconsistently only
    ///      misleads its own counterpart.
    ///
    ///      Integration rule for consumers: derive `slotKey` and
    ///      `collectionKeys` inside your contract from the same validated
    ///      input. Never expose a pass-through that lets untrusted callers
    ///      choose them independently.
    ///
    ///      Send exactly `proofRequestQueueFee`: any excess is retained as
    ///      protocol fees rather than refunded, which keeps this function free
    ///      of outbound calls. Read the fee in the same transaction to avoid
    ///      racing a change to it.
    /// @param slotKey Raw 32-byte storage key to prove under `msg.sender`.
    /// @param collectionKeys Up to `MAX_COLLECTION_KEYS` identifiers locating
    ///        the value within its collection.
    /// @return requestId Queue index assigned to this request.
    function requestProof(
        bytes32 slotKey,
        bytes32[] calldata collectionKeys
    ) external payable returns (uint256 requestId) {
        if (msg.value < proofRequestQueueFee) revert InsufficientFee();

        uint256 keysCount = collectionKeys.length;
        if (keysCount > MAX_COLLECTION_KEYS) revert TooManyCollectionKeys();

        accumulatedFees += msg.value;

        requestId = head;
        Request storage request = _requests[requestId];
        request.target = msg.sender;
        request.slotKey = slotKey;
        request.collectionKeysCount = uint8(keysCount);
        // Unused key words are never written, so they stay absent from the
        // storage trie and the circuit reads them as zero via an exclusion
        // proof. Ids are never reused, so there is nothing stale to clear.
        for (uint256 k = 0; k < keysCount; k++) {
            request.collectionKeys[k] = collectionKeys[k];
        }

        // Cannot realistically overflow: one enqueue costs at least a
        // non-zero SSTORE, so 2^256 requests are unreachable.
        unchecked {
            head = requestId + 1;
        }

        emit ProofRequested(requestId, msg.sender, slotKey, collectionKeys);
    }

    // -------------------------------
    // Views
    // -------------------------------
    /// @notice Read a queued request, including its collection keys.
    /// @param requestId Queue index. Ids at or beyond `head` read as an
    ///        all-zero record rather than reverting.
    function requests(
        uint256 requestId
    ) external view returns (Request memory) {
        return _requests[requestId];
    }

    // -------------------------------
    // Admin: Operator Rotation
    // -------------------------------
    /// @notice Rotate the operator to a new address.
    /// @dev Allows migration from one Timelock or Safe to another without
    ///      redeploying — the provable slots are untouched by this call.
    function setOperator(address newOperator) external onlyOperator {
        if (newOperator == address(0)) revert ZeroAddress();

        address oldOperator = operator;
        operator = newOperator;

        emit OperatorSet(oldOperator, newOperator);
    }

    // -------------------------------
    // Admin: Fee Configuration
    // -------------------------------
    /// @notice Set the per-request fee.
    /// @dev Timelocking is external: `operator` is the TimelockController, so
    ///      every change already carries the timelock delay and Safe
    ///      approval. `MAX_PROOF_REQUEST_QUEUE_FEE` bounds the outcome anyway.
    /// @param newFee New fee in wei; at most `MAX_PROOF_REQUEST_QUEUE_FEE` and
    ///        a multiple of `PROOF_REQUEST_QUEUE_FEE_GRANULARITY_WEI`.
    function setProofRequestQueueFee(uint256 newFee) external onlyOperator {
        if (newFee > MAX_PROOF_REQUEST_QUEUE_FEE)
            revert ProofRequestQueueFeeTooHigh();
        if (newFee % PROOF_REQUEST_QUEUE_FEE_GRANULARITY_WEI != 0)
            revert ProofRequestQueueFeeNotAligned();

        uint256 oldFee = proofRequestQueueFee;
        proofRequestQueueFee = newFee;

        emit ProofRequestQueueFeeSet(oldFee, newFee);
    }

    /// @notice Set the fee recipient (treasury) address.
    function setFeeRecipient(address newRecipient) external onlyOperator {
        if (newRecipient == address(0)) revert ZeroAddress();

        address oldRecipient = feeRecipient;
        feeRecipient = newRecipient;

        emit FeeRecipientSet(oldRecipient, newRecipient);
    }

    /// @notice Withdraw accumulated fees to the fee recipient.
    /// @dev Only callable by the feeRecipient. Uses CEI; deliberately not
    ///      guarded by OpenZeppelin's ReentrancyGuard, whose `_status` would
    ///      occupy provable slot 0. A reentrant call would find
    ///      `accumulatedFees` already zeroed and revert with
    ///      `NoFeesToWithdraw`.
    function withdrawFees() external {
        if (feeRecipient == address(0)) revert FeeRecipientNotSet();
        if (msg.sender != feeRecipient) revert NotFeeRecipient();

        uint256 fees = accumulatedFees;
        if (fees == 0) revert NoFeesToWithdraw();

        // Effects before interaction
        accumulatedFees = 0;

        (bool ok, ) = payable(feeRecipient).call{value: fees}('');
        if (!ok) revert EthTransferFailed();

        emit FeesWithdrawn(feeRecipient, fees);
    }

    receive() external payable {
        revert('Use requestProof to enqueue a proof request');
    }
}
