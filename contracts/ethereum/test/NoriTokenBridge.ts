import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import hre from "hardhat";

describe("NoriTokenBridge", function () {
  async function deployTokenBridgeFixture() {
    const [owner, otherAccount] = await hre.ethers.getSigners();

    const TokenBridge = await hre.ethers.getContractFactory("NoriTokenBridge");
    const tokenBridge = await TokenBridge.deploy();

    return { tokenBridge, owner, otherAccount };
  }

  describe("Deployment", function () {
    it("Should set the deployer as the bridge operator", async function () {
      const { tokenBridge, owner } = await loadFixture(
        deployTokenBridgeFixture
      );
      expect(await tokenBridge.bridgeOperator()).to.equal(owner.address);
    });
  });

  describe("Locking Tokens", function () {
    it("Should allow users to lock tokens and update mapping", async function () {
      const { tokenBridge, owner } = await loadFixture(
        deployTokenBridgeFixture
      );

      const sendValue = hre.ethers.parseEther("1.0");
      await tokenBridge.lockTokens({ value: sendValue });

      const locked = await tokenBridge.lockedTokens(owner.address);
      expect(locked).to.equal(sendValue);
    });

    it("Should emit TokensLocked event with correct parameters", async function () {
      const { tokenBridge, owner } = await loadFixture(
        deployTokenBridgeFixture
      );
      const sendValue = hre.ethers.parseEther("0.5");

      // Send the transaction and wait for the receipt
      const tx = await tokenBridge.lockTokens({ value: sendValue });
      const receipt = await tx.wait();

      if (!receipt) {
        throw new Error("Transaction was not mined in time, receipt is null");
      }

      // Fetch the block timestamp of the mined transaction
      const block = await hre.ethers.provider.getBlock(receipt.blockNumber);

      if (!block) {
        throw new Error(`Block number ${receipt.blockNumber} not found`);
      }

      const blockTimestamp = block.timestamp;

      // Now assert event emission with exact timestamp
      await expect(tx)
        .to.emit(tokenBridge, "TokensLocked")
        .withArgs(owner.address, sendValue, blockTimestamp);
    });

    it("Should revert if no Ether is sent", async function () {
      const { tokenBridge } = await loadFixture(deployTokenBridgeFixture);

      await expect(tokenBridge.lockTokens()).to.be.revertedWith(
        "You must send some Ether to lock"
      );
    });

    it("Should allow multiple locks from same address", async function () {
      const { tokenBridge, owner } = await loadFixture(
        deployTokenBridgeFixture
      );

      const value1 = hre.ethers.parseEther("0.2");
      const value2 = hre.ethers.parseEther("0.8");

      await tokenBridge.lockTokens({ value: value1 });
      await tokenBridge.lockTokens({ value: value2 });

      const total = await tokenBridge.lockedTokens(owner.address);
      expect(total).to.equal(value1 + value2);
    });
  });
});
