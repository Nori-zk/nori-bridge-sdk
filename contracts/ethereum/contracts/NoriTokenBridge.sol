// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {MinaStateSettlement} from './MinaStateSettlement.sol';
import {MinaAccountValidation} from './MinaAccountValidation.sol';
import '@openzeppelin/contracts/utils/ReentrancyGuard.sol';

/// @title NoriTokenBridge
/// @notice Lock ETH for Mina accounts with bridge unit validation, depositor binding, and fee collection.
/// @dev The `bridgeOperator` is expected to be a Safe (multisig) smart account in production.
///      This contract does not implement multisig logic internally — it trusts a single admin
///      address and delegates multi-signature governance to the Safe contract itself.
///      Fees are collected on both lock and unlock operations and are withdrawable by a
///      separate `feeRecipient` address (treasury).
contract NoriTokenBridge is ReentrancyGuard {
    // -------------------------------
    // Constants
    // -------------------------------
    uint8 public constant DECIMALS = 6;
    uint256 public constant MAX_MAGNITUDE = (1 << 64) - 1; // 64-bit magnitude
    uint256 public constant WEI_PER_BRIDGE_UNIT = 10 ** (18 - DECIMALS); // smallest bridge unit (BU) in wei
    uint16 public constant MAX_FEE_RATE = 10_000; // 10% hard cap (1 unit = 0.001%)
    uint32 public constant FEE_DENOMINATOR = 100_000;
    uint256 public constant MIN_FEE_BU = 10;
    uint256 public constant MIN_LOCK_AMOUNT_WEI = 100 * WEI_PER_BRIDGE_UNIT; // 0.0001 ETH minimum deposit
    // -------------------------------
    // Custom Errors
    // -------------------------------
    error AlignedContractsNotConfigured();
    error ZeroAddress();
    error NotBridgeOperator();
    error BelowMinLockAmount();
    error InvalidBridgeUnitMultiple();
    error TotalLockedOverflow();
    error MinaAccountLinkedToDifferentDepositor();
    error InvalidLedger();
    error InvalidZkappAccount();
    error InvalidUnlockAmount();
    error EthTransferFailed();
    error BurnCounterNotIncreased();
    error IncorrectZkappVerificationKey();
    error IncorrectTokenHolderAccount();
    error FeeRateTooHigh();
    error NotFeeRecipient();
    error FeeRecipientNotSet();
    error NoFeesToWithdraw();

    // -------------------------------
    // State Variables
    // -------------------------------
    address public bridgeOperator;

    // lifetimeLockedByDepositor
    // Mina signature hash -> Bridge units locked amount
    mapping(uint256 => uint256) public lockedTokens;

    // Total locked supply in bridge units
    uint256 public totalLockedBU;

    // Mina account (depositKey) -> ETH depositor
    mapping(uint256 => address) public depositKeyToEthAddress;

    /// @notice Mina bridge contract that validates and stores Mina states.
    MinaStateSettlement public stateSettlement;
    /// @notice Mina bridge contract that validates accounts
    MinaAccountValidation public accountValidation;

    // Hash(publicKey, tokenId) -> burnSoFar (in bridge units, matches Mina appState)
    mapping(uint256 => uint256) public unlockedTokens;

    /// @notice The NoriStorageInterface zkApp verification key hash. Set at deployment.
    bytes32 public immutable NORI_STORAGE_ZKAPP_ACCT_VERIFICATION_KEY_HASH;
    /// @notice The NoriStorageInterface zkApp tokenID. Set at deployment.
    bytes32 public immutable NORI_BRIDGE_ZKAPP_ACCT_TOKEN_ID;
    // -------------------------------
    // Fee State
    // -------------------------------
    address public feeRecipient;
    uint16 public lockFeeRate;
    uint16 public unlockFeeRate;
    uint256 public accumulatedFees;

    // -------------------------------
    // Events
    // -------------------------------
    event TokensLocked(
        address indexed user,
        uint256 indexed codeChallenge,
        uint256 amount,
        uint256 fee
    );
    event TokensUnlocked(
        uint256 indexed pubKeyTokenIdHash,
        uint256 amount,
        uint256 fee,
        address receiver
    );
    event StateSettlementSet(address indexed newAddress);
    event AccountValidationSet(address indexed newAddress);
    event BridgeOperatorSet(
        address indexed oldOperator,
        address indexed newOperator
    );
    event LockFeeRateSet(uint16 oldRate, uint16 newRate);
    event UnlockFeeRateSet(uint16 oldRate, uint16 newRate);
    event FeeRecipientSet(
        address indexed oldRecipient,
        address indexed newRecipient
    );
    event FeesWithdrawn(address indexed recipient, uint256 amount);

    // -------------------------------
    // Modifiers
    // -------------------------------
    modifier onlyBridgeOperator() {
        if (msg.sender != bridgeOperator) revert NotBridgeOperator();
        _;
    }

    modifier onlyConfigured() {
        if (!isConfigured()) revert AlignedContractsNotConfigured();
        _;
    }

    // -------------------------------
    // Constructor
    // -------------------------------
    /// @param _bridgeOperator The admin address (expected to be a Safe in production).
    /// @param _stateSettlementAddr Mina state settlement contract address.
    /// @param _accountValidationAddr Mina account validation contract address.
    /// @param _zkappAcctTokenId The Mina zkApp account tokenID expected during unlock validation.
    /// @param _zkappAcctVerificationKeyHash The keccak256 of the ABI-encoded NoriStorage zkApp
    ///        verification key, expected during unlock validation.
    /// @param _feeRecipient Initial treasury address that will receive accumulated fees.
    ///        Pass `address(0)` to defer; it can be configured later via `setFeeRecipient`.
    constructor(
        address _bridgeOperator,
        address _stateSettlementAddr,
        address _accountValidationAddr,
        bytes32 _zkappAcctTokenId,
        bytes32 _zkappAcctVerificationKeyHash,
        address _feeRecipient
    ) {
        assert(DECIMALS < 18);
        if (
            _bridgeOperator == address(0) ||
            _stateSettlementAddr == address(0) ||
            _accountValidationAddr == address(0)
        ) revert ZeroAddress();
        bridgeOperator = _bridgeOperator;

        stateSettlement = MinaStateSettlement(_stateSettlementAddr);
        accountValidation = MinaAccountValidation(_accountValidationAddr);
        NORI_BRIDGE_ZKAPP_ACCT_TOKEN_ID = _zkappAcctTokenId;
        NORI_STORAGE_ZKAPP_ACCT_VERIFICATION_KEY_HASH = _zkappAcctVerificationKeyHash;

        if (_feeRecipient != address(0)) {
            feeRecipient = _feeRecipient;
            emit FeeRecipientSet(address(0), _feeRecipient);
        }

        emit StateSettlementSet(_stateSettlementAddr);
        emit AccountValidationSet(_accountValidationAddr);
    }
    // -------------------------------
    // Configuration
    // those should only change if mina has hardfork - only done with timelock
    // or changes in the Mina zkapp architecture that would require updating the aligned contracts
    // -------------------------------
    function setAlignedContracts(
        address _stateSettlementAddr,
        address _accountValidationAddr
    ) external onlyBridgeOperator {
        if (
            _stateSettlementAddr == address(0) ||
            _accountValidationAddr == address(0)
        ) revert ZeroAddress();

        stateSettlement = MinaStateSettlement(_stateSettlementAddr);
        accountValidation = MinaAccountValidation(_accountValidationAddr);

        emit StateSettlementSet(_stateSettlementAddr);
        emit AccountValidationSet(_accountValidationAddr);
    }

    function isConfigured() public view returns (bool) {
        return
            address(stateSettlement) != address(0) &&
            address(accountValidation) != address(0);
    }
    // -------------------------------
    // Lock ETH for a Mina account
    // -------------------------------
    // codeChallenge is the hash of the Mina signature
    function lockTokens(uint256 codeChallenge) external payable onlyConfigured {
        // ===============================
        // VALIDATION
        // ===============================
        if (msg.value < MIN_LOCK_AMOUNT_WEI) revert BelowMinLockAmount();
        if (msg.value % WEI_PER_BRIDGE_UNIT != 0)
            revert InvalidBridgeUnitMultiple();

        // ===============================
        // FEE DEDUCTION (in bridge units)
        // ===============================
        uint256 grossBU = msg.value / WEI_PER_BRIDGE_UNIT;
        uint256 feeBU = (grossBU * lockFeeRate) / FEE_DENOMINATOR;
        // Round up: minimum MIN_FEE_BU fee when a rate is configured
        if (lockFeeRate > 0 && feeBU < MIN_FEE_BU) feeBU = MIN_FEE_BU;

        uint256 netBU = grossBU - feeBU;
        uint256 feeWei = feeBU * WEI_PER_BRIDGE_UNIT;

        // Ensure total locked supply does not exceed MAX_MAGNITUDE
        if (totalLockedBU + netBU > MAX_MAGNITUDE) revert TotalLockedOverflow();

        // Enforce one ETH depositor per Mina account
        // Attack vector if a deposit key is in the mempool they could claim this eth for themselves.
        // And then when the actual user came to mint they would be locked out, but atleast they wouldn't be bricked.
        address linkedEthAddress = depositKeyToEthAddress[codeChallenge];
        if (linkedEthAddress == address(0)) {
            // First deposit: bind Mina account deposit key to sender
            depositKeyToEthAddress[codeChallenge] = msg.sender;
        } else {
            if (linkedEthAddress != msg.sender)
                revert MinaAccountLinkedToDifferentDepositor();
        }

        // ===============================
        // LOCK LOGIC (bridge units internally)
        // ===============================
        lockedTokens[codeChallenge] += netBU;
        totalLockedBU += netBU;
        accumulatedFees += feeWei;

        emit TokensLocked(
            msg.sender,
            codeChallenge,
            netBU * WEI_PER_BRIDGE_UNIT,
            feeWei
        );
    }

    /// @notice Unlock tokens by bridging from Mina.
    /// @dev Permissionless — anyone can submit a valid proof to unlock. Protected by
    ///      `nonReentrant` since ETH is sent via low-level `call`.
    ///      Fee is deducted from the payout right before the transfer.
    ///      `unlockedTokens` tracks the full amount (inclusive of fee) to stay aligned
    ///      with Mina-side burn accounting.
    function unlockTokens(
        bytes32 proofCommitment,
        bytes32 provingSystemAuxDataCommitment,
        bytes20 proofGeneratorAddr,
        bytes32 batchMerkleRoot,
        bytes memory merkleProof,
        uint256 verificationDataBatchIndex,
        bytes calldata pubInput,
        address batcherPaymentService
    ) external onlyConfigured nonReentrant {
        bytes32 ledgerHash = bytes32(pubInput[:32]);
        if (!stateSettlement.isLedgerVerified(ledgerHash))
            revert InvalidLedger();

        MinaAccountValidation.AlignedArgs memory args = MinaAccountValidation
            .AlignedArgs(
                proofCommitment,
                provingSystemAuxDataCommitment,
                proofGeneratorAddr,
                batchMerkleRoot,
                merkleProof,
                verificationDataBatchIndex,
                pubInput,
                batcherPaymentService
            );
        if (!accountValidation.validateAccount(args))
            revert InvalidZkappAccount();

        bytes calldata encodedAccount = pubInput[32 + 8:];
        MinaAccountValidation.Account memory account = abi.decode(
            encodedAccount,
            (MinaAccountValidation.Account)
        );

        // check that this account represents the circuit we expect
        // VerificationKey is ABI-encoded then hashed with keccak256 (Solidity has no Poseidon).
        bytes32 verificationKeyHash = keccak256(
            abi.encode(account.zkapp.verificationKey)
        );

        if (
            verificationKeyHash != NORI_STORAGE_ZKAPP_ACCT_VERIFICATION_KEY_HASH
        ) revert IncorrectZkappVerificationKey();

        // check if the tokenId is aligned
        if (account.tokenIdKeyHash != NORI_BRIDGE_ZKAPP_ACCT_TOKEN_ID)
            revert IncorrectTokenHolderAccount();

        uint256 pubKeyTokenIdHash = uint256(
            keccak256(abi.encode(account.publicKey, account.tokenIdKeyHash))
        );
        uint256 unlockedTokensSoFar = unlockedTokens[pubKeyTokenIdHash];
        uint256 burntTokensSoFar = uint256(account.zkapp.appState[2]);
        // check if burnedSoFar at Mina account is greater than the existing burnSoFar
        if (burntTokensSoFar <= unlockedTokensSoFar)
            revert BurnCounterNotIncreased();

        // gas optimization: bypass built-in underflow check since we just verified this condition
        uint256 tokensToUnlock;
        unchecked {
            tokensToUnlock = burntTokensSoFar - unlockedTokensSoFar;
        }

        // ===============================
        // UNLOCK LOGIC (checks-effects-interactions)
        // ===============================
        unlockedTokens[pubKeyTokenIdHash] = burntTokensSoFar;
        // Ensure we don't unlock more than we have locked (should never happen if proofs are valid)
        if (tokensToUnlock > totalLockedBU) revert InvalidUnlockAmount();
        totalLockedBU -= tokensToUnlock;

        // ===============================
        // Fees and payout calculation
        // ===============================
        uint256 feeBU = (tokensToUnlock * unlockFeeRate) / FEE_DENOMINATOR;
        // Round up: minimum 10 bridge unit fee when a rate is configured
        if (unlockFeeRate > 0 && feeBU < MIN_FEE_BU) feeBU = MIN_FEE_BU;

        if (tokensToUnlock <= feeBU) revert InvalidUnlockAmount();

        uint256 netBU;
        unchecked {
            netBU = tokensToUnlock - feeBU; // Safe because of the line above
        }
        uint256 feeWei = feeBU * WEI_PER_BRIDGE_UNIT;
        uint256 netWei = netBU * WEI_PER_BRIDGE_UNIT;
        accumulatedFees += feeWei;

        // Interaction: transfer net payout to the receiver
        address receiver = address(uint160(uint256(account.zkapp.appState[3])));
        if (receiver == address(0)) revert ZeroAddress();

        (bool ok, ) = payable(receiver).call{value: netWei}('');
        if (!ok) revert EthTransferFailed();

        emit TokensUnlocked(
            pubKeyTokenIdHash,
            tokensToUnlock * WEI_PER_BRIDGE_UNIT,
            feeWei,
            receiver
        );
    }

    // -------------------------------
    // Admin: Operator Rotation
    // -------------------------------
    /// @notice Rotate the bridge operator to a new address.
    /// @dev Allows migration from one Safe to another without redeploying.
    /// @param newOperator The new bridge operator address.
    function setBridgeOperator(
        address newOperator
    ) external onlyBridgeOperator {
        if (newOperator == address(0)) revert ZeroAddress();

        address oldOperator = bridgeOperator;
        bridgeOperator = newOperator;

        emit BridgeOperatorSet(oldOperator, newOperator);
    }

    // -------------------------------
    // Admin: Fee Configuration
    // -------------------------------
    /// @notice Set the fee rate for lock operations.
    /// @param newRate Fee rate (1 unit = 0.001%, max 10000 = 10%).
    function setLockFeeRate(uint16 newRate) external onlyBridgeOperator {
        if (newRate > MAX_FEE_RATE) revert FeeRateTooHigh();

        uint16 oldRate = lockFeeRate;
        lockFeeRate = newRate;

        emit LockFeeRateSet(oldRate, newRate);
    }

    /// @notice Set the fee rate for unlock operations.
    /// @param newRate Fee rate (1 unit = 0.001%, max 10000 = 10%).
    function setUnlockFeeRate(uint16 newRate) external onlyBridgeOperator {
        if (newRate > MAX_FEE_RATE) revert FeeRateTooHigh();

        uint16 oldRate = unlockFeeRate;
        unlockFeeRate = newRate;

        emit UnlockFeeRateSet(oldRate, newRate);
    }

    /// @notice Set the fee recipient (treasury) address.
    /// @param newRecipient Address that will receive accumulated fees via withdrawFees().
    function setFeeRecipient(address newRecipient) external onlyBridgeOperator {
        if (newRecipient == address(0)) revert ZeroAddress();

        address oldRecipient = feeRecipient;
        feeRecipient = newRecipient;

        emit FeeRecipientSet(oldRecipient, newRecipient);
    }

    /// @notice Withdraw accumulated protocol fees to the fee recipient.
    /// @dev Only callable by the feeRecipient. Uses CEI pattern + nonReentrant.
    function withdrawFees() external nonReentrant {
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
        revert('Use lockTokens to lock Ether');
    }
    // -------------------------------
    // View Helper: compute gross lock amount for a desired net
    // -------------------------------
    /// @notice Compute the msg.value needed to lock a desired net amount after fees.
    /// @dev The returned grossAmount is clamped to at least MIN_LOCK_AMOUNT_WEI so it
    ///      will always pass lockTokens() validation. If the caller's desiredNetAmount
    ///      is tiny, actualNetAmount may exceed it due to the minimum gross constraint.
    /// @param desiredNetAmount The net amount (in wei) the caller wants locked.
    /// @return grossAmount The msg.value to send (includes fee).
    /// @return fee The fee portion that will be deducted.
    /// @return actualNetAmount The actual net amount that will be locked (in wei).
    function calcGrossLockAmount(
        uint256 desiredNetAmount
    )
        external
        view
        returns (uint256 grossAmount, uint256 fee, uint256 actualNetAmount)
    {
        // Round desired net up to bridge units
        uint256 desiredNetBU = (desiredNetAmount + WEI_PER_BRIDGE_UNIT - 1) /
            WEI_PER_BRIDGE_UNIT;

        uint256 grossBU;

        if (lockFeeRate == 0) {
            grossBU = desiredNetBU;
        } else {
            // Ceiling division so resulting net is at least desiredNetBU
            uint256 denominator = FEE_DENOMINATOR - lockFeeRate;
            grossBU =
                (desiredNetBU * FEE_DENOMINATOR + denominator - 1) /
                denominator;

            uint256 feeBU0 = (grossBU * lockFeeRate) / FEE_DENOMINATOR;
            if (feeBU0 < MIN_FEE_BU) {
                grossBU = desiredNetBU + MIN_FEE_BU;
            }
        }

        // Enforce minimum gross deposit (mirrors lockTokens validation)
        uint256 minGrossBU = MIN_LOCK_AMOUNT_WEI / WEI_PER_BRIDGE_UNIT;
        if (grossBU < minGrossBU) {
            grossBU = minGrossBU;
        }

        // Recompute fee from actual grossBU so result exactly matches lockTokens()
        uint256 feeBU = (grossBU * lockFeeRate) / FEE_DENOMINATOR;
        if (lockFeeRate > 0 && feeBU < MIN_FEE_BU) {
            feeBU = MIN_FEE_BU;
        }

        uint256 netBU = grossBU - feeBU;

        grossAmount = grossBU * WEI_PER_BRIDGE_UNIT;
        fee = feeBU * WEI_PER_BRIDGE_UNIT;
        actualNetAmount = netBU * WEI_PER_BRIDGE_UNIT;
    }
}
