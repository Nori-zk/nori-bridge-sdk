// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import "./MinaStateSettlementExample.sol";
import "./MinaAccountValidationExample.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title NoriTokenBridge
/// @notice Lock ETH for Mina accounts with bridge unit validation and depositor binding.
/// @dev The `bridgeOperator` is expected to be a Safe (multisig) smart account in production.
///      This contract does not implement multisig logic internally — it trusts a single admin
///      address and delegates multi-signature governance to the Safe contract itself.
contract NoriTokenBridge is ReentrancyGuard {
    // -------------------------------
    // Constants (these should be slotless and converted to bytecode)
    // -------------------------------
    uint8 public constant DECIMALS = 6;
    uint64 public constant MAX_MAGNITUDE = (1 << 64) - 1; // 64-bit magnitude
    uint256 public constant WEI_PER_BRIDGE_UNIT = 10 ** (18 - DECIMALS); // smallest bridge unit in wei

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
    error NoEthToWithdraw();
    error EthTransferFailed();
    error BurnAmountUnderflow();
    error IncorrectTokenHolderAccount();

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
    // Events
    // -------------------------------
    event TokensLocked(address indexed user, uint256 attestationHash, uint256 amount, uint256 when);
    event TokensUnlocked(uint256 indexed pubKeyTokenIdHash, uint256 amount, address receiver, uint256 when);
    event StateSettlementSet(address indexed newAddress);
    event AccountValidationSet(address indexed newAddress);
    event BridgeOperatorSet(address indexed oldOperator, address indexed newOperator);

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
    // Admin: Operator Rotation
    // -------------------------------
    /// @notice Rotate the bridge operator to a new address.
    /// @dev Allows migration from one Safe to another without redeploying.
    /// @param newOperator The new bridge operator address.
    function setBridgeOperator(address newOperator) external onlyBridgeOperator {
        if (newOperator == address(0)) revert ZeroAddress();

        address oldOperator = bridgeOperator;
        bridgeOperator = newOperator;

        emit BridgeOperatorSet(oldOperator, newOperator);
    }

    // -------------------------------
    // Configuration
    // -------------------------------
    function setAlignedContracts(address _stateSettlementAddr, address _accountValidationAddr) external onlyBridgeOperator {
        if (_stateSettlementAddr == address(0) || _accountValidationAddr == address(0)) revert ZeroAddress();

        stateSettlement = MinaStateSettlementExample(_stateSettlementAddr);
        accountValidation = MinaAccountValidationExample(_accountValidationAddr);

        emit StateSettlementSet(_stateSettlementAddr);
        emit AccountValidationSet(_accountValidationAddr);
    }

    function isConfigured() public view returns (bool) {
        return address(stateSettlement) != address(0) && address(accountValidation) != address(0);
    }

    // -------------------------------
    // Lock ETH for a Mina account
    // -------------------------------
    function lockTokens(uint256 attestationHash) public payable onlyConfigured {
        // ===============================
        // VALIDATION
        // ===============================
        if (msg.value == 0) revert InvalidAmount();

        // Convert wei to bridge units
        uint256 bridgeAmount = msg.value / WEI_PER_BRIDGE_UNIT;

        // Ensure deposit is a whole multiple of bridge unit
        if (msg.value % WEI_PER_BRIDGE_UNIT != 0) revert InvalidBridgeUnitMultiple();

        // Ensure total locked supply does not exceed MAX_MAGNITUDE
        if (totalLocked + bridgeAmount > MAX_MAGNITUDE) revert TotalLockedOverflow();

        // Enforce one ETH depositor per Mina account
        address linkedEth = codeChallengeToEthAddress[attestationHash];
        if (linkedEth == address(0)) {
            // First deposit: bind Mina account to sender
            codeChallengeToEthAddress[attestationHash] = msg.sender;
        } else {
            if (linkedEth != msg.sender) revert MinaAccountAlreadyLinked();
        }

        // ===============================
        // LOCK LOGIC
        // ===============================
        lockedTokens[msg.sender][attestationHash] += msg.value;
        totalLocked += bridgeAmount;

        emit TokensLocked(msg.sender, attestationHash, msg.value, block.timestamp);
    }

    /// @notice Unlock tokens by bridging from Mina.
    /// @dev Permissionless — anyone can submit a valid proof to unlock. Protected by
    ///      `nonReentrant` since ETH is sent via low-level `call`.
    function unlockTokens(
        uint256 toUnlockAmount, // token to unlock
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
        if (!stateSettlement.isLedgerVerified(ledgerHash)) revert InvalidLedger();

        MinaAccountValidationExample.AlignedArgs memory args = MinaAccountValidationExample.AlignedArgs(
            proofCommitment,
            provingSystemAuxDataCommitment,
            proofGeneratorAddr,
            batchMerkleRoot,
            merkleProof,
            verificationDataBatchIndex,
            pubInput,
            batcherPaymentService
        );
        if (!accountValidation.validateAccount(args)) revert InvalidZkappAccount();

        bytes calldata encodedAccount = pubInput[32 + 8:];
        MinaAccountValidationExample.Account memory account = abi.decode(encodedAccount, (MinaAccountValidationExample.Account));

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
        uint256 pubKeyTokenIdHash = uint256(keccak256(abi.encode(account.publicKey, account.tokenIdKeyHash)));
        uint256 burnSoFar0 = burnSoFarSet[pubKeyTokenIdHash];
        uint256 bridgeAmount = uint256(account.zkapp.appState[2]) - burnSoFar0;
        if (bridgeAmount == 0) revert BurnAmountUnderflow();

        // ===============================
        // UNLOCK LOGIC (checks-effects-interactions)
        // ===============================
        if (toUnlockAmount > bridgeAmount) revert InvalidUnlockAmount();

        // Effects: update state before external call
        burnSoFarSet[pubKeyTokenIdHash] = burnSoFar0 + toUnlockAmount;

        // Interaction: transfer ETH to the receiver
        address receiver = address(uint160(uint256(account.zkapp.appState[3])));

        // TODO FOR TEST-ALIGN
        // totalLocked -= toUnlockAmount;
        (bool ok, ) = payable(receiver).call{value: toUnlockAmount}("");
        if (!ok) revert EthTransferFailed();

        emit TokensUnlocked(pubKeyTokenIdHash, toUnlockAmount, receiver, block.timestamp);
    }

    // -------------------------------
    // Admin-only withdraw all ETH
    // -------------------------------
    function withdraw() public onlyBridgeOperator onlyConfigured nonReentrant {
        uint256 balance = address(this).balance;
        if (balance == 0) revert NoEthToWithdraw();

        (bool ok, ) = payable(bridgeOperator).call{value: balance}("");
        if (!ok) revert EthTransferFailed();
    }
}