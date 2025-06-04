// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract LockTokens {
    address public bridgeOperator;
    mapping(address => uint256) public lockedTokens;

    event TokensLocked(address indexed user, uint256 amount, uint256 when);

    constructor() {
        bridgeOperator = msg.sender;
    }

    function lockTokens() public payable {
        lockedTokens[msg.sender] += msg.value;
        emit TokensLocked(msg.sender, msg.value, block.timestamp);
    }
}
