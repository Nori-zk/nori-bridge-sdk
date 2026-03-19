// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import './MinaStateSettlement.sol';
import './MinaAccountValidation.sol';
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
    uint64 public constant MAX_MAGNITUDE = (1 << 64) - 1; // 64-bit magnitude
    uint256 public constant WEI_PER_BRIDGE_UNIT = 10 ** (18 - DECIMALS); // smallest bridge unit in wei
    uint16 public constant MAX_FEE_BPS = 10_000; // 10% hard cap (1 bps = 0.001%)
    uint32 public constant BPS_DENOMINATOR = 100_000;
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
    error MinaAccountAlreadyLinked();
    error InvalidLedger();
    error InvalidZkappAccount();
    error InvalidUnlockAmount();
    error EthTransferFailed();
    error BurnAmountUnderflow();
    error IncorrectTokenHolderAccount();
    error FeeBpsTooHigh();
    error NotFeeRecipient();
    error FeeRecipientNotSet();
    error NoFeesToWithdraw();

    // -------------------------------
    // State Variables
    // -------------------------------
    address public bridgeOperator;

    // Bridge units locked per ETH address per Mina account (attestationHash)
    mapping(address => mapping(uint256 => uint256)) public lockedTokens;

    // Total locked supply in bridge units
    uint256 public totalLocked;

    // Mina account (attestationHash) -> ETH depositor
    mapping(uint256 => address) public codeChallengeToEthAddress;

    /// The NoriStorageInterface zkApp verification key hash.
    // uint256 constant NORI_STORAGE_ZKAPP_ACCT_VERIFICATION_KEY_HASH = 0xdc9c283f73ce17466a01b90d36141b848805a3db129b6b80d581adca52c9b6f3;

    /// @notice The NoriStorageInterface zkApp tokenID.
    uint256 constant NORI_STORAGE_ZKAPP_ACCT_TOKEN_ID =
        0x1b848805a3db129b6b41adca52c9b6f380d58dc9c283f73ce17466a01b90d361; // TODO need change it

    /// @notice Mina bridge contract that validates and stores Mina states.
    MinaStateSettlement stateSettlement;
    /// @notice Mina bridge contract that validates accounts
    MinaAccountValidation accountValidation;

    // Hash(publicKey, tokenId) -> burnSoFar (in bridge units, matches Mina appState)
    mapping(uint256 => uint256) public burnSoFarSet;

    // -------------------------------
    // Fee State
    // -------------------------------
    address public feeRecipient;
    uint16 public lockFeeBps;
    uint16 public unlockFeeBps;
    uint256 public accumulatedFees;

    // -------------------------------
    // Events
    // -------------------------------
    event TokensLocked(
        address indexed user,
        uint256 indexed attestationHash,
        uint256 amount,
        uint256 fee,
        uint256 when
    );
    event TokensUnlocked(
        uint256 indexed pubKeyTokenIdHash,
        uint256 amount,
        uint256 fee,
        address receiver,
        uint256 when
    );
    event StateSettlementSet(address indexed newAddress);
    event AccountValidationSet(address indexed newAddress);
    event BridgeOperatorSet(
        address indexed oldOperator,
        address indexed newOperator
    );
    event LockFeeBpsSet(uint16 oldBps, uint16 newBps);
    event UnlockFeeBpsSet(uint16 oldBps, uint16 newBps);
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
    constructor(address _bridgeOperator) payable {
        if (_bridgeOperator == address(0)) revert ZeroAddress();
        bridgeOperator = _bridgeOperator;
    }
    // -------------------------------
    // Configuration
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
    function lockTokens(uint256 attestationHash) public payable onlyConfigured {
        // ===============================
        // VALIDATION
        // ===============================
        if (msg.value < MIN_LOCK_AMOUNT_WEI) revert BelowMinLockAmount();
        if (msg.value % WEI_PER_BRIDGE_UNIT != 0)
            revert InvalidBridgeUnitMultiple();

        // ===============================
        // FEE DEDUCTION (in bridge units)
        // ===============================
        uint256 grossBridgeUnits = msg.value / WEI_PER_BRIDGE_UNIT;
        uint256 feeBU = (grossBridgeUnits * lockFeeBps) / BPS_DENOMINATOR;
        // Round up: minimum MIN_FEE_BU fee when a rate is configured
        if (lockFeeBps > 0 && feeBU < MIN_FEE_BU) feeBU = MIN_FEE_BU;

        uint256 netBridgeUnits = grossBridgeUnits - feeBU;
        uint256 feeWei = feeBU * WEI_PER_BRIDGE_UNIT;

        // Ensure total locked supply does not exceed MAX_MAGNITUDE
        if (totalLocked + netBridgeUnits > MAX_MAGNITUDE)
            revert TotalLockedOverflow();

        // Enforce one ETH depositor per Mina account
        address linkedEth = codeChallengeToEthAddress[attestationHash];
        if (linkedEth == address(0)) {
            // First deposit: bind Mina account to sender
            codeChallengeToEthAddress[attestationHash] = msg.sender;
        } else {
            if (linkedEth != msg.sender) revert MinaAccountAlreadyLinked();
        }

        // ===============================
        // LOCK LOGIC (bridge units internally)
        // ===============================
        lockedTokens[msg.sender][attestationHash] += netBridgeUnits;
        totalLocked += netBridgeUnits;
        accumulatedFees += feeWei;

        emit TokensLocked(
            msg.sender,
            attestationHash,
            netBridgeUnits * WEI_PER_BRIDGE_UNIT,
            feeWei,
            block.timestamp
        );
    }

    /// @notice Unlock tokens by bridging from Mina.
    /// @dev Permissionless — anyone can submit a valid proof to unlock. Protected by
    ///      `nonReentrant` since ETH is sent via low-level `call`.
    ///      Fee is deducted from the payout right before the transfer.
    ///      `burnSoFarSet` tracks the full amount (inclusive of fee) to stay aligned
    ///      with Mina-side burn accounting.
    function unlockTokens(
        // uint256 toUnlockAmount, // token to unlock
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

        /* TODO MUST UNCOMMENT these conditions check in production
        // check that this account represents the circuit we expect
        // uint256 verificationKeyHash = uint256(keccak256(
        //    abi.encode(account.zkapp.verificationKey)
        // ));
        // require(verificationKeyHash == NORI_STORAGE_ZKAPP_ACCT_VERIFICATION_KEY_HASH, "Incorrect Zkapp Account"); // TODO Do we need check vk??

        // check if the tokenId is aligned
        if (uint256(account.tokenIdKeyHash) != NORI_STORAGE_ZKAPP_ACCT_TOKEN_ID) revert IncorrectTokenHolderAccount();
*/

        // check if burnedSoFar at Mina account is greater than the existing burnSoFar
        uint256 pubKeyTokenIdHash = uint256(
            keccak256(abi.encode(account.publicKey, account.tokenIdKeyHash))
        );
        uint256 burnSoFar0 = burnSoFarSet[pubKeyTokenIdHash];
        uint256 bridgeAmountBU = uint256(account.zkapp.appState[2]) -
            burnSoFar0;
        if (bridgeAmountBU == 0) revert BurnAmountUnderflow();

        // ===============================
        // UNLOCK LOGIC (checks-effects-interactions)
        // ===============================

        burnSoFarSet[pubKeyTokenIdHash] = burnSoFar0 + bridgeAmountBU;

        uint256 feeBU = (bridgeAmountBU * unlockFeeBps) / BPS_DENOMINATOR;
        // Round up: minimum 10 bridge unit fee when a rate is configured
        if (unlockFeeBps > 0 && feeBU < MIN_FEE_BU) feeBU = MIN_FEE_BU;
        uint256 netBridgeUnits = bridgeAmountBU - feeBU;
        uint256 feeWei = feeBU * WEI_PER_BRIDGE_UNIT;
        uint256 netWei = netBridgeUnits * WEI_PER_BRIDGE_UNIT;
        accumulatedFees += feeWei;

        // Interaction: transfer net payout to the receiver
        address receiver = address(uint160(uint256(account.zkapp.appState[3])));

        totalLocked -= bridgeAmountBU;
        (bool ok, ) = payable(receiver).call{value: netWei}('');
        if (!ok) revert EthTransferFailed();

        emit TokensUnlocked(
            pubKeyTokenIdHash,
            bridgeAmountBU * WEI_PER_BRIDGE_UNIT,
            feeWei,
            receiver,
            block.timestamp
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
    /// @param newBps Fee in basis points (1 bps = 0.001%, max 10000 = 10%).
    function setLockFeeBps(uint16 newBps) external onlyBridgeOperator {
        if (newBps > MAX_FEE_BPS) revert FeeBpsTooHigh();

        uint16 oldBps = lockFeeBps;
        lockFeeBps = newBps;

        emit LockFeeBpsSet(oldBps, newBps);
    }

    /// @notice Set the fee rate for unlock operations.
    /// @param newBps Fee in basis points (1 bps = 0.001%, max 10000 = 10%).
    function setUnlockFeeBps(uint16 newBps) external onlyBridgeOperator {
        if (newBps > MAX_FEE_BPS) revert FeeBpsTooHigh();

        uint16 oldBps = unlockFeeBps;
        unlockFeeBps = newBps;

        emit UnlockFeeBpsSet(oldBps, newBps);
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

    // -------------------------------
    // View Helper: compute gross lock amount for a desired net
    // -------------------------------
    /// @notice Compute the msg.value needed to lock a desired net amount after fees.
    /// @param desiredNetAmount The net amount (in wei) the caller wants locked.
    /// @return grossAmount The msg.value to send (includes fee).
    /// @return fee The fee portion that will be deducted.
    function calcGrossLockAmount(
        uint256 desiredNetAmount
    ) external view returns (uint256 grossAmount, uint256 fee) {
        if (lockFeeBps == 0) return (desiredNetAmount, 0);
        // Work in bridge units for consistency with lockTokens math
        uint256 desiredNetBU = desiredNetAmount / WEI_PER_BRIDGE_UNIT;
        // Ceiling division to ensure net >= desiredNetBU
        uint256 grossBU = (desiredNetBU *
            BPS_DENOMINATOR +
            (BPS_DENOMINATOR - lockFeeBps) -
            1) / (BPS_DENOMINATOR - lockFeeBps);
        grossAmount = grossBU * WEI_PER_BRIDGE_UNIT;
        fee = grossAmount - desiredNetAmount;
    }
}
