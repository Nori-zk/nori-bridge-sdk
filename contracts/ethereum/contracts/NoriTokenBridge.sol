// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

contract NoriTokenBridge {
    address public bridgeOperator;
    mapping(address => mapping(uint256 => uint256)) public lockedTokens; // address => attestationHash => amount

    event TokensLocked(address indexed user, uint256 attestationHash, uint256 amount, uint256 when);

    constructor() {
        bridgeOperator = msg.sender;
    }

    function lockTokens(uint256 attestationHash) public payable {
        require(msg.value > 0, "You must send some Ether to lock");

        lockedTokens[msg.sender][attestationHash] += msg.value;

        emit TokensLocked(msg.sender, attestationHash, msg.value, block.timestamp);
    }
}
