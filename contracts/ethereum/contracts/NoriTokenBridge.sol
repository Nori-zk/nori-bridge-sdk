// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

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

    // -------------------------------
    // Events
    // -------------------------------
    event TokensLocked(address indexed user, uint256 attestationHash, uint256 amount, uint256 when);

    // -------------------------------
    // Constructor
    // -------------------------------
    constructor() {
        bridgeOperator = msg.sender;
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