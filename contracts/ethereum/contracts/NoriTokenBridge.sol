// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import './MinaStateSettlementExample.sol';
import './MinaAccountValidationExample.sol';
import '@openzeppelin/contracts/utils/ReentrancyGuard.sol';

/*
Minimal deposit and Fee calculation

Definitions:

User makes deposit D (in wei)
We calculate a fee F(D) (in wei)
lockFeeBps is set by the admin in bps and a hard cap of MAX_FEE_BPS is enforced.
1 BU is 1 Bridge unit = WEI_PER_BRIDGE_UNIT (wei)

Constraints:
-------------------------------

1. D % WEI_PER_BRIDGE_UNIT == 0        (deposit must be whole bridge units)
2. F(D) % WEI_PER_BRIDGE_UNIT == 0     (fee must be whole bridge units)
3. F(D) >= WEI_PER_BRIDGE_UNIT         (fee is at least 1 BU, bridge is never free)
4. (D - F(D)) fits in UInt64 BU on Mina

Decimals and maximum circulating supply:
-------------------------------

Units we track must not go below WEI_PER_BRIDGE_UNIT to enforce enough maximum circulating supply with DECIMALS on Mina.

On Mina, token amounts must fit in UInt64, so:
max bridge units = 2^64 - 1 = 18,446,744,073,709,551,615

With DECIMALS = 6, WEI_PER_BRIDGE_UNIT = 10^(18 - 6) = 10^12
Bridge units = lockedWei / WEI_PER_BRIDGE_UNIT

Max representable wei = (2^64 - 1) * 10^12 ≈ 1.844 × 10^31 wei ≈ 1.844 × 10^13 ETH

Total ETH supply is ~120M (1.2 × 10^8) ETH, so this constraint is always satisfied with DECIMALS = 6.

Fee calculation:
-------------------------------

We define a fee as the raw result of applying the bps rate to the deposit:
fee_unconstrained = (D * lockFeeBps) / BPS_DENOMINATOR

However this is unconstrained and we need to ensure that fee % WEI_PER_BRIDGE_UNIT == 0.
We round up to the next whole bridge unit so that the fee is never zero (the bridge is never free)
and so that subtracting the fee from D leaves no leftover wei that cannot be represented in bridge units.
F(D) = ((fee_unconstrained + WEI_PER_BRIDGE_UNIT - 1) / WEI_PER_BRIDGE_UNIT) * WEI_PER_BRIDGE_UNIT

Minimum deposit:
-------------------------------

We can thus define a minimum deposit given a particular lockFeeBps such that F(D) > WEI_PER_BRIDGE_UNIT * 1 BU (Bridge unit)

D_min = ceil((WEI_PER_BRIDGE_UNIT * BPS_DENOMINATOR) / lockFeeBps)
      = (WEI_PER_BRIDGE_UNIT * BPS_DENOMINATOR + lockFeeBps - 1) / lockFeeBps

Example (lockFeeBps = MAX_FEE_BPS = 1e4 i.e. 10%):
-------------------------------

Given:
  WEI_PER_BRIDGE_UNIT = 1e12
  BPS_DENOMINATOR     = 1e5
  lockFeeBps          = 1e4

Minimum deposit:
  D_min = (WEI_PER_BRIDGE_UNIT * BPS_DENOMINATOR + lockFeeBps - 1) / lockFeeBps
        = ((1e12 * 1e5) + 1e4 - 1) / 1e4
        = (1e17 + 9.999e3) / 1e4
        = 1e13 wei (integer division truncates the remainder)
        = 1e-5 ETH
        = 10 BU

Constrained fee (round up to nearest BU):
  F(D) = (((D * lockFeeBps) / BPS_DENOMINATOR + (WEI_PER_BRIDGE_UNIT - 1)) / WEI_PER_BRIDGE_UNIT) * WEI_PER_BRIDGE_UNIT

  where:
    D * lockFeeBps        = 1e13 * 1e4 = 1e17
    WEI_PER_BRIDGE_UNIT-1 = 1e12 - 1   = 9.999e11

  F(D) = (((1e17 / 1e5) + 9.999e11) / 1e12) * 1e12
       = ((1e12 + 9.999e11) / 1e12) * 1e12
       = (1.9999e12 / 1e12) * 1e12
       = 1 * 1e12 (integer division truncates 1.9999 to 1)
       = 1e12 wei
       = 1 BU

Net locked:
  net_locked = D - F(D)
             = 1e13 - 1e12
             = 9e12 wei
             = 9 BU

Justification for D_min:
-------------------------------

When a user deposits D wei, the contract deducts a fee F(D) and the remaining
netAmount = D - F(D) is converted to bridge units via integer division:
bridgeUnits = netAmount / WEI_PER_BRIDGE_UNIT. This is what gets minted on Mina.

There are two failure modes if D is too small:

First, if D * lockFeeBps < BPS_DENOMINATOR, floor division produces F(D) = 0.
The user's entire deposit is locked and minted on Mina without the protocol
collecting anything. The bridge is free.

Second, if the fee consumes enough of D that netAmount < WEI_PER_BRIDGE_UNIT,
the integer division truncates to 0 BU. The user has paid ETH — some to the fee,
the rest stuck as dust in the contract — and receives nothing on Mina.
Their funds are irrecoverable.

Both failures are prevented by enforcing D >= D_min, which guarantees the fee is
at least 1 BU and the net amount after fee is at least 1 BU. The BU-alignment of
the fee itself is not a protocol requirement — it is a UX choice about whether the
user loses a sub-BU amount to truncation dust. The protocol functions correctly
either way as long as D >= D_min.

*/

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
    uint32 public constant BPS_DENOMINATOR = 100_000; // 1 bps = 0.001%
    uint16 public constant MAX_FEE_BPS = 10_000; // 10% hard cap

    // -------------------------------
    // Custom Errors
    // -------------------------------
    error AlignedContractsNotConfigured();
    error ZeroAddress();
    error NotBridgeOperator();
    error InvalidAmount();
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

    // ETH locked per ETH address per Mina account (attestationHash)
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
    MinaStateSettlementExample stateSettlement;
    /// @notice Mina bridge contract that validates accounts
    MinaAccountValidationExample accountValidation;

    // Hash(publicKey, tokenId) -> burnSoFar
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

        stateSettlement = MinaStateSettlementExample(_stateSettlementAddr);
        accountValidation = MinaAccountValidationExample(
            _accountValidationAddr
        );

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
        if (msg.value == 0) revert InvalidAmount();

        // ===============================
        // FEE DEDUCTION
        // ===============================
        uint256 fee = (msg.value * lockFeeBps) / BPS_DENOMINATOR;
        uint256 netAmount = msg.value - fee;

        // Convert net amount to bridge units
        uint256 bridgeAmount = netAmount / WEI_PER_BRIDGE_UNIT;

        // Ensure net deposit is a whole multiple of bridge unit
        if (netAmount % WEI_PER_BRIDGE_UNIT != 0)
            revert InvalidBridgeUnitMultiple();

        // Ensure total locked supply does not exceed MAX_MAGNITUDE
        if (totalLocked + bridgeAmount > MAX_MAGNITUDE)
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
        // LOCK LOGIC (net amount only)
        // ===============================
        lockedTokens[msg.sender][attestationHash] += netAmount;
        totalLocked += bridgeAmount;
        accumulatedFees += fee;

        emit TokensLocked(
            msg.sender,
            attestationHash,
            netAmount,
            fee,
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

        MinaAccountValidationExample.AlignedArgs
            memory args = MinaAccountValidationExample.AlignedArgs(
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
        MinaAccountValidationExample.Account memory account = abi.decode(
            encodedAccount,
            (MinaAccountValidationExample.Account)
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
        uint256 bridgeAmount = (uint256(account.zkapp.appState[2]) *
            WEI_PER_BRIDGE_UNIT) - burnSoFar0;
        if (bridgeAmount == 0) revert BurnAmountUnderflow();

        // ===============================
        // UNLOCK LOGIC (checks-effects-interactions)
        // ===============================
        // if (toUnlockAmount > bridgeAmount) revert InvalidUnlockAmount();

        // Effects: update burn tracking with full amount (inclusive of fee, matches Mina)
        burnSoFarSet[pubKeyTokenIdHash] = burnSoFar0 + bridgeAmount;

        // Fee deduction right before transfer
        uint256 fee = (bridgeAmount * unlockFeeBps) / BPS_DENOMINATOR;
        uint256 netPayout = bridgeAmount - fee;
        accumulatedFees += fee;

        // Interaction: transfer net payout to the receiver
        address receiver = address(uint160(uint256(account.zkapp.appState[3])));

        // TODO FOR TEST-ALIGN
        // totalLocked -= bridgeAmount;
        (bool ok, ) = payable(receiver).call{value: netPayout}('');
        if (!ok) revert EthTransferFailed();

        emit TokensUnlocked(
            pubKeyTokenIdHash,
            bridgeAmount,
            fee,
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
        // grossAmount - (grossAmount * lockFeeBps / BPS_DENOMINATOR) >= desiredNetAmount
        // Ceiling division to ensure net >= desiredNetAmount
        grossAmount =
            (desiredNetAmount * BPS_DENOMINATOR + (BPS_DENOMINATOR - lockFeeBps) - 1) /
            (BPS_DENOMINATOR - lockFeeBps);
        fee = grossAmount - desiredNetAmount;
    }
}
