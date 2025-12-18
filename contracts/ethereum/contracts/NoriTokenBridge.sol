// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import "./MinaStateSettlementExample.sol";
import "./MinaAccountValidationExample.sol";

/// @title NoriTokenBridge
/// @notice Lock ETH for Mina accounts with bridge unit validation and depositor binding
contract NoriTokenBridge {
    // -------------------------------
    // Constants (these should be slotless and converted to bytecode)
    // -------------------------------
    uint8 public constant DECIMALS = 6; 
    uint64 public constant MAX_MAGNITUDE = (1 << 64) - 1; // 64-bit magnitude
    uint256 public constant WEI_PER_BRIDGE_UNIT = 10 ** (18 - DECIMALS); // smallest bridge unit in wei

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

    /// @notice The NoriStorageInterface zkApp verification key hash.
    uint256 constant NORI_STORAGE_ZKAPP_ACCT_VERIFICATION_KEY_HASH =
        0xdc9c283f73ce17466a01b90d36141b848805a3db129b6b80d581adca52c9b6f3; // TODO need change it

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

    // -------------------------------
    // Constructor
    // -------------------------------
    constructor(address _stateSettlementAddr, address _accountValidationAddr) payable /*TODO Keep Payable for TEST(Mina->ETHEREUM)*/{
        bridgeOperator = msg.sender;
        
        stateSettlement = MinaStateSettlementExample(_stateSettlementAddr);
        accountValidation = MinaAccountValidationExample(_accountValidationAddr);
    }

    // -------------------------------
    // Lock ETH for a Mina account
    // -------------------------------
    function lockTokens(uint256 attestationHash) public payable {
        // ===============================
        // VALIDATION
        // ===============================
        require(msg.value > 0, "You must send some Ether to lock");

        // Convert wei to bridge units
        uint256 bridgeAmount = msg.value / WEI_PER_BRIDGE_UNIT;

        // Ensure deposit is a whole multiple of bridge unit
        require(msg.value % WEI_PER_BRIDGE_UNIT == 0, "Must be multiple of smallest bridge unit");

        // Ensure total locked supply does not exceed MAX_MAGNITUDE
        require(totalLocked + bridgeAmount <= MAX_MAGNITUDE, "Total locked exceeds maximum allowed");

        // Enforce one ETH depositor per Mina account
        address linkedEth = codeChallengeToEthAddress[attestationHash];
        if (linkedEth == address(0)) {
            // First deposit: bind Mina account to sender
            codeChallengeToEthAddress[attestationHash] = msg.sender;
        } else {
            require(linkedEth == msg.sender, "This Mina account is already linked to a different ETH address");
        }

        // ===============================
        // LOCK LOGIC
        // ===============================
        lockedTokens[msg.sender][attestationHash] += msg.value;
        totalLocked += bridgeAmount;

        emit TokensLocked(msg.sender, attestationHash, msg.value, block.timestamp);
    }
    
    /// @notice unlock the tokens by bridging from Mina
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
    ) external {
        bytes32 ledgerHash = bytes32(pubInput[:32]);
        require(stateSettlement.isLedgerVerified(ledgerHash), "Invalid Ledger");

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
        require(accountValidation.validateAccount(args), "Invalid Zkapp Account");

        bytes calldata encodedAccount = pubInput[32 + 8:];
        MinaAccountValidationExample.Account memory account = abi.decode(encodedAccount, (MinaAccountValidationExample.Account));

        // check that this account represents the circuit we expect
        uint256 verificationKeyHash = uint256(keccak256(
            abi.encode(account.zkapp.verificationKey)
        ));
        // TODO temporarily comment this check for test purpose, this is required!
        // require(verificationKeyHash == NORI_STORAGE_ZKAPP_ACCT_VERIFICATION_KEY_HASH, "Incorrect Zkapp Account");

        // check if burnedSoFar at Mina account is greater than the existing burnSoFar
        uint256 pubKeyTokenIdHash = uint256(keccak256(abi.encode(account.publicKey, account.tokenIdKeyHash)));
        uint256 burnSoFar0 = burnSoFarSet[pubKeyTokenIdHash];
        uint256 bridgeAmount = uint256(account.zkapp.appState[2]) - burnSoFar0;
        require(bridgeAmount > 0, "Burn so far is greater than the amount to burn");

        // ===============================
        // UNLOCK LOGIC
        // ===============================
        require(toUnlockAmount <= bridgeAmount, "To unlock amount is greater than the amount to unlock");
        burnSoFarSet[pubKeyTokenIdHash] = burnSoFar0 + toUnlockAmount;

        // transfer the tokens to the user
        address receiver = address(uint160(uint256(account.zkapp.appState[3])));

        // TODO FOR TEST-ALIGN
        // totalLocked -= toUnlockAmount;
        payable(receiver).transfer(toUnlockAmount);

        emit TokensUnlocked(pubKeyTokenIdHash, toUnlockAmount, receiver, block.timestamp);
    }

    // -------------------------------
    // Admin-only withdraw all ETH
    // -------------------------------
    function withdraw() public {
        require(msg.sender == bridgeOperator, "Only bridge operator can withdraw");

        uint256 balance = address(this).balance;
        require(balance > 0, "No ETH to withdraw");

        payable(bridgeOperator).transfer(balance);
    }
}