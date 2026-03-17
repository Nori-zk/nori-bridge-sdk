import { expect } from 'chai';
import { getRandomValues } from 'crypto';
import { NoriTokenBridge__factory } from 'types/ethers-contracts/index.js';
import hre from 'hardhat';
const { ethers } = await hre.network.connect();

const attestationHashBytes = new Uint8Array(32);
getRandomValues(attestationHashBytes);
const attestationHashBigInt = attestationHashBytes.reduce(
    (acc, byte) => (acc << 8n) + BigInt(byte),
    0n
);
const attestationHashHex = `0x${Array.from(attestationHashBytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;

console.log('attestationHashBigInt', attestationHashBigInt);
console.log('attestationHashHex', attestationHashHex);

describe('NoriTokenBridge', () => {
    async function deployTokenBridgeFixture() {
        const [owner, user1, user2, dummyState, dummyAccount, treasury] = await ethers.getSigners();

        const TokenBridge = new NoriTokenBridge__factory(owner);

        // Constructor now requires explicit bridgeOperator address
        const tokenBridge = await TokenBridge.deploy(owner.address);

        // Configure with dummy aligned contract addresses so onlyConfigured passes
        await tokenBridge.setAlignedContracts(dummyState.address, dummyAccount.address);

        return { tokenBridge, owner, user1, user2, dummyState, dummyAccount, treasury };
    }

    // -----------------------------------------------------------
    // Deployment & Constructor
    // -----------------------------------------------------------
    describe('Deployment', function () {
        it('Should set the provided address as the bridge operator', async function () {
            const { tokenBridge, owner } = await deployTokenBridgeFixture();
            expect(await tokenBridge.bridgeOperator()).equals(owner.address);
        });

        it('Should allow deploying with a different bridgeOperator than deployer', async function () {
            const [deployer, operator, dummyState, dummyAccount] = await ethers.getSigners();
            const TokenBridge = new NoriTokenBridge__factory(deployer);
            const tokenBridge = await TokenBridge.deploy(operator.address);

            expect(await tokenBridge.bridgeOperator()).equals(operator.address);

            // deployer should NOT be able to call admin functions
            await expect(
                tokenBridge.connect(deployer).setAlignedContracts(dummyState.address, dummyAccount.address)
            ).to.be.revertedWithCustomError(tokenBridge, 'NotBridgeOperator');

            // operator should be able to
            await tokenBridge.connect(operator).setAlignedContracts(dummyState.address, dummyAccount.address);
        });

        it('Should revert if bridgeOperator is zero address', async function () {
            const [deployer] = await ethers.getSigners();
            const TokenBridge = new NoriTokenBridge__factory(deployer);
            await expect(
                TokenBridge.deploy(ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(TokenBridge, 'ZeroAddress');
        });

        it('Should accept ETH during deployment (payable constructor)', async function () {
            const [deployer] = await ethers.getSigners();
            const TokenBridge = new NoriTokenBridge__factory(deployer);
            const tokenBridge = await TokenBridge.deploy(deployer.address, {
                value: ethers.parseEther('1.0'),
            });
            const balance = await ethers.provider.getBalance(tokenBridge.target);
            expect(balance).to.equal(ethers.parseEther('1.0'));
        });

        it('Should initialize fees to zero', async function () {
            const { tokenBridge } = await deployTokenBridgeFixture();
            expect(await tokenBridge.lockFeeBps()).to.equal(0);
            expect(await tokenBridge.unlockFeeBps()).to.equal(0);
            expect(await tokenBridge.accumulatedFees()).to.equal(0n);
            expect(await tokenBridge.feeRecipient()).to.equal(ethers.ZeroAddress);
        });
    });

    // -----------------------------------------------------------
    // setBridgeOperator (admin rotation)
    // -----------------------------------------------------------
    describe('setBridgeOperator', function () {
        it('Should allow the current operator to rotate to a new operator', async function () {
            const { tokenBridge, owner, user1 } = await deployTokenBridgeFixture();

            await expect(tokenBridge.connect(owner).setBridgeOperator(user1.address))
                .to.emit(tokenBridge, 'BridgeOperatorSet')
                .withArgs(owner.address, user1.address);

            expect(await tokenBridge.bridgeOperator()).equals(user1.address);
        });

        it('Should revoke access from the old operator after rotation', async function () {
            const { tokenBridge, owner, user1 } = await deployTokenBridgeFixture();

            await tokenBridge.connect(owner).setBridgeOperator(user1.address);

            await expect(
                tokenBridge.connect(owner).setBridgeOperator(owner.address)
            ).to.be.revertedWithCustomError(tokenBridge, 'NotBridgeOperator');

            await tokenBridge.connect(user1).setBridgeOperator(user1.address);
        });

        it('Should revert if non-operator tries to set bridge operator', async function () {
            const { tokenBridge, user1, user2 } = await deployTokenBridgeFixture();

            await expect(
                tokenBridge.connect(user1).setBridgeOperator(user2.address)
            ).to.be.revertedWithCustomError(tokenBridge, 'NotBridgeOperator');
        });

        it('Should revert if setting bridge operator to zero address', async function () {
            const { tokenBridge, owner } = await deployTokenBridgeFixture();

            await expect(
                tokenBridge.connect(owner).setBridgeOperator(ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(tokenBridge, 'ZeroAddress');
        });
    });

    // -----------------------------------------------------------
    // Fee Configuration
    // -----------------------------------------------------------
    describe('Fee Configuration', function () {
        it('Should allow operator to set lock fee BPS and emit event', async function () {
            const { tokenBridge, owner } = await deployTokenBridgeFixture();

            await expect(tokenBridge.connect(owner).setLockFeeBps(50))
                .to.emit(tokenBridge, 'LockFeeBpsSet')
                .withArgs(0, 50);

            expect(await tokenBridge.lockFeeBps()).to.equal(50);
        });

        it('Should allow operator to set unlock fee BPS and emit event', async function () {
            const { tokenBridge, owner } = await deployTokenBridgeFixture();

            await expect(tokenBridge.connect(owner).setUnlockFeeBps(100))
                .to.emit(tokenBridge, 'UnlockFeeBpsSet')
                .withArgs(0, 100);

            expect(await tokenBridge.unlockFeeBps()).to.equal(100);
        });

        it('Should revert if lock fee exceeds MAX_FEE_BPS', async function () {
            const { tokenBridge, owner } = await deployTokenBridgeFixture();
            const maxFeeBps = Number(await tokenBridge.MAX_FEE_BPS());

            await expect(
                tokenBridge.connect(owner).setLockFeeBps(maxFeeBps + 1)
            ).to.be.revertedWithCustomError(tokenBridge, 'FeeBpsTooHigh');
        });

        it('Should revert if unlock fee exceeds MAX_FEE_BPS', async function () {
            const { tokenBridge, owner } = await deployTokenBridgeFixture();
            const maxFeeBps = Number(await tokenBridge.MAX_FEE_BPS());

            await expect(
                tokenBridge.connect(owner).setUnlockFeeBps(maxFeeBps + 1)
            ).to.be.revertedWithCustomError(tokenBridge, 'FeeBpsTooHigh');
        });

        it('Should allow setting fee at exactly MAX_FEE_BPS', async function () {
            const { tokenBridge, owner } = await deployTokenBridgeFixture();

            await tokenBridge.connect(owner).setLockFeeBps(10000);
            expect(await tokenBridge.lockFeeBps()).to.equal(10000);

            await tokenBridge.connect(owner).setUnlockFeeBps(10000);
            expect(await tokenBridge.unlockFeeBps()).to.equal(10000);
        });

        it('Should revert if non-operator sets lock fee', async function () {
            const { tokenBridge, user1 } = await deployTokenBridgeFixture();

            await expect(
                tokenBridge.connect(user1).setLockFeeBps(50)
            ).to.be.revertedWithCustomError(tokenBridge, 'NotBridgeOperator');
        });

        it('Should revert if non-operator sets unlock fee', async function () {
            const { tokenBridge, user1 } = await deployTokenBridgeFixture();

            await expect(
                tokenBridge.connect(user1).setUnlockFeeBps(50)
            ).to.be.revertedWithCustomError(tokenBridge, 'NotBridgeOperator');
        });

        it('Should allow operator to set fee recipient and emit event', async function () {
            const { tokenBridge, owner, treasury } = await deployTokenBridgeFixture();

            await expect(tokenBridge.connect(owner).setFeeRecipient(treasury.address))
                .to.emit(tokenBridge, 'FeeRecipientSet')
                .withArgs(ethers.ZeroAddress, treasury.address);

            expect(await tokenBridge.feeRecipient()).to.equal(treasury.address);
        });

        it('Should revert if non-operator sets fee recipient', async function () {
            const { tokenBridge, user1, treasury } = await deployTokenBridgeFixture();

            await expect(
                tokenBridge.connect(user1).setFeeRecipient(treasury.address)
            ).to.be.revertedWithCustomError(tokenBridge, 'NotBridgeOperator');
        });

        it('Should revert if setting fee recipient to zero address', async function () {
            const { tokenBridge, owner } = await deployTokenBridgeFixture();

            await expect(
                tokenBridge.connect(owner).setFeeRecipient(ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(tokenBridge, 'ZeroAddress');
        });

        it('MAX_FEE_BPS should equal 10000', async function () {
            const { tokenBridge } = await deployTokenBridgeFixture();
            expect(await tokenBridge.MAX_FEE_BPS()).to.equal(10000);
        });
    });

    // -----------------------------------------------------------
    // Locking Tokens (0% fee — regression)
    // -----------------------------------------------------------
    describe('Locking Tokens (no fee)', function () {
        it('Should allow users to lock tokens and update mapping (BigInt)', async function () {
            const { tokenBridge, owner } = await deployTokenBridgeFixture();

            const sendValue = ethers.parseEther('1.0');

            await tokenBridge
                .connect(owner)
                .lockTokens(attestationHashBigInt, { value: sendValue });

            const locked = await tokenBridge.lockedTokens(
                owner.address,
                attestationHashBigInt
            );
            expect(locked).to.equal(sendValue);
        });

        it('Should allow users to lock tokens and update mapping (hex string)', async function () {
            const { tokenBridge, owner } = await deployTokenBridgeFixture();

            const sendValue = ethers.parseEther('1.0');
            await tokenBridge
                .connect(owner)
                .lockTokens(attestationHashHex, { value: sendValue });

            const locked = await tokenBridge.lockedTokens(
                owner.address,
                attestationHashHex
            );
            expect(locked).to.equal(sendValue);
        });

        it('Should emit TokensLocked event with zero fee at 0% (BigInt)', async function () {
            const { tokenBridge, owner } = await deployTokenBridgeFixture();
            const sendValue = ethers.parseEther('0.5');

            const tx = await tokenBridge
                .connect(owner)
                .lockTokens(attestationHashBigInt, { value: sendValue });
            const receipt = await tx.wait();
            if (!receipt) throw new Error('Transaction was not mined in time');

            const block = await ethers.provider.getBlock(receipt.blockNumber);
            if (!block) throw new Error(`Block ${receipt.blockNumber} not found`);

            await expect(tx)
                .to.emit(tokenBridge, 'TokensLocked')
                .withArgs(
                    owner.address,
                    attestationHashHex,
                    sendValue,
                    0n, // fee = 0 at 0%
                    block.timestamp
                );
        });

        it('Should revert if no Ether is sent (custom error)', async function () {
            const { tokenBridge, owner } = await deployTokenBridgeFixture();

            await expect(
                tokenBridge
                    .connect(owner)
                    .lockTokens(attestationHashBigInt, { value: 0n })
            ).to.be.revertedWithCustomError(tokenBridge, 'InvalidAmount');
        });

        it('Should allow multiple locks from same address', async function () {
            const { tokenBridge, owner } = await deployTokenBridgeFixture();

            const value1 = ethers.parseEther('0.2');
            const value2 = ethers.parseEther('0.8');

            await tokenBridge
                .connect(owner)
                .lockTokens(attestationHashBigInt, { value: value1 });
            await tokenBridge
                .connect(owner)
                .lockTokens(attestationHashBigInt, { value: value2 });

            const total = await tokenBridge.lockedTokens(
                owner.address,
                attestationHashBigInt
            );
            expect(total).to.equal(value1 + value2);
        });
    });

    // -----------------------------------------------------------
    // Locking Tokens with Fees
    // -----------------------------------------------------------
    describe('Locking Tokens (with fee)', function () {
        it('Should deduct fee and store only net amount in lockedTokens', async function () {
            const { tokenBridge, owner, user1 } = await deployTokenBridgeFixture();

            // Set 50 bps = 0.05% lock fee
            await tokenBridge.connect(owner).setLockFeeBps(50);

            const sendValue = ethers.parseEther('1.0'); // 1 ETH
            // fee = 1 ETH * 50 / 100000 = 0.0005 ETH = 500_000_000_000_000 wei
            const expectedFee = sendValue * 50n / 100000n;
            const expectedNet = sendValue - expectedFee;

            await tokenBridge
                .connect(user1)
                .lockTokens(attestationHashBigInt, { value: sendValue });

            // lockedTokens should have net amount
            const locked = await tokenBridge.lockedTokens(user1.address, attestationHashBigInt);
            expect(locked).to.equal(expectedNet);

            // accumulatedFees should have fee
            const fees = await tokenBridge.accumulatedFees();
            expect(fees).to.equal(expectedFee);
        });

        it('Should update totalLocked based on net amount in bridge units', async function () {
            const { tokenBridge, owner, user1 } = await deployTokenBridgeFixture();

            await tokenBridge.connect(owner).setLockFeeBps(50);

            const sendValue = ethers.parseEther('1.0');
            const expectedFee = sendValue * 50n / 100000n;
            const expectedNet = sendValue - expectedFee;
            const weiPerBridgeUnit = await tokenBridge.WEI_PER_BRIDGE_UNIT();
            const expectedBridgeUnits = expectedNet / weiPerBridgeUnit;

            await tokenBridge
                .connect(user1)
                .lockTokens(attestationHashBigInt, { value: sendValue });

            const totalLocked = await tokenBridge.totalLocked();
            expect(totalLocked).to.equal(expectedBridgeUnits);
        });

        it('Should emit TokensLocked with net amount and fee', async function () {
            const { tokenBridge, owner, user1 } = await deployTokenBridgeFixture();

            await tokenBridge.connect(owner).setLockFeeBps(100); // 0.1%

            const sendValue = ethers.parseEther('2.0');
            const expectedFee = sendValue * 100n / 100000n; // 0.002 ETH
            const expectedNet = sendValue - expectedFee;

            const tx = await tokenBridge
                .connect(user1)
                .lockTokens(attestationHashBigInt, { value: sendValue });
            const receipt = await tx.wait();
            if (!receipt) throw new Error('Tx not mined');
            const block = await ethers.provider.getBlock(receipt.blockNumber);
            if (!block) throw new Error('Block not found');

            await expect(tx)
                .to.emit(tokenBridge, 'TokensLocked')
                .withArgs(
                    user1.address,
                    attestationHashBigInt,
                    expectedNet,
                    expectedFee,
                    block.timestamp
                );
        });

        it('Should revert if net amount is not a bridge unit multiple', async function () {
            const { tokenBridge, owner, user1 } = await deployTokenBridgeFixture();

            // Set 3 bps = 0.003%
            await tokenBridge.connect(owner).setLockFeeBps(3);

            // WEI_PER_BRIDGE_UNIT = 10^12
            // Send exactly 1 bridge unit = 10^12 wei
            // fee = 10^12 * 3 / 100000 = 30_000_000 wei
            // net = 10^12 - 30_000_000 = 999_970_000_000 wei
            // 999_970_000_000 % 10^12 = 999_970_000_000 (not zero, so should revert)
            const weiPerBridgeUnit = 10n ** 12n;
            const smallAmount = weiPerBridgeUnit; // exactly 1 bridge unit

            await expect(
                tokenBridge
                    .connect(user1)
                    .lockTokens(attestationHashBigInt, { value: smallAmount })
            ).to.be.revertedWithCustomError(tokenBridge, 'InvalidBridgeUnitMultiple');
        });

        it('Should handle fee rates where net remains bridge-unit-aligned', async function () {
            const { tokenBridge, owner, user1 } = await deployTokenBridgeFixture();

            // Set 500 bps = 0.5%
            // For 1 ETH: fee = 10^18 * 500 / 100000 = 5 * 10^15 = 0.005 ETH
            // net = 0.995 ETH = 995000000000000000 wei
            // 995000000000000000 / 10^12 = 995000 (exact, bridge-unit-aligned)
            await tokenBridge.connect(owner).setLockFeeBps(500);

            const sendValue = ethers.parseEther('1.0');
            const expectedFee = sendValue * 500n / 100000n;
            const expectedNet = sendValue - expectedFee;

            await tokenBridge
                .connect(user1)
                .lockTokens(attestationHashBigInt, { value: sendValue });

            const locked = await tokenBridge.lockedTokens(user1.address, attestationHashBigInt);
            expect(locked).to.equal(expectedNet);

            const fees = await tokenBridge.accumulatedFees();
            expect(fees).to.equal(expectedFee);
        });

        it('Should accumulate fees across multiple locks', async function () {
            const { tokenBridge, owner, user1 } = await deployTokenBridgeFixture();

            await tokenBridge.connect(owner).setLockFeeBps(100); // 0.1%

            const value1 = ethers.parseEther('1.0');
            const value2 = ethers.parseEther('2.0');
            const fee1 = value1 * 100n / 100000n;
            const fee2 = value2 * 100n / 100000n;

            await tokenBridge.connect(user1).lockTokens(attestationHashBigInt, { value: value1 });
            await tokenBridge.connect(user1).lockTokens(attestationHashBigInt, { value: value2 });

            const fees = await tokenBridge.accumulatedFees();
            expect(fees).to.equal(fee1 + fee2);
        });
    });

    // -----------------------------------------------------------
    // Bridge Unit / v2Rpc Tests
    // -----------------------------------------------------------
    describe('v2Rpc Tests', function () {
        it('Should convert wei to bridge units and update totalLocked correctly', async function () {
            const { tokenBridge, user1 } = await deployTokenBridgeFixture();
            const weiPerBridgeUnit = await tokenBridge.WEI_PER_BRIDGE_UNIT();

            const sendValue = ethers.parseEther('1.0');
            const expectedBridgeUnits = sendValue / weiPerBridgeUnit;

            await tokenBridge
                .connect(user1)
                .lockTokens(attestationHashBigInt, { value: sendValue });

            const totalLocked = await tokenBridge.totalLocked();
            expect(totalLocked).to.equal(expectedBridgeUnits);
        });

        it('Should revert if value is not a multiple of bridge unit', async function () {
            const { tokenBridge, user1 } = await deployTokenBridgeFixture();
            const weiPerBridgeUnit = await tokenBridge.WEI_PER_BRIDGE_UNIT();

            const invalidAmount = weiPerBridgeUnit + 1n;
            await expect(
                tokenBridge
                    .connect(user1)
                    .lockTokens(attestationHashBigInt, { value: invalidAmount })
            ).to.be.revertedWithCustomError(tokenBridge, 'InvalidBridgeUnitMultiple');
        });

        it('Should bind Mina account to first depositor and reject others', async function () {
            const { tokenBridge, user1, user2 } = await deployTokenBridgeFixture();
            const sendValue = ethers.parseEther('1.0');

            await tokenBridge
                .connect(user1)
                .lockTokens(attestationHashBigInt, { value: sendValue });
            const linked = await tokenBridge.codeChallengeToEthAddress(
                attestationHashBigInt
            );
            expect(linked).to.equal(user1.address);

            await expect(
                tokenBridge
                    .connect(user2)
                    .lockTokens(attestationHashBigInt, { value: sendValue })
            ).to.be.revertedWithCustomError(tokenBridge, 'MinaAccountAlreadyLinked');
        });

        it('Should allow the same depositor to add more ETH to same Mina account', async function () {
            const { tokenBridge, user1 } = await deployTokenBridgeFixture();
            const sendValue1 = ethers.parseEther('0.5');
            const sendValue2 = ethers.parseEther('1.0');

            await tokenBridge
                .connect(user1)
                .lockTokens(attestationHashBigInt, { value: sendValue1 });
            await tokenBridge
                .connect(user1)
                .lockTokens(attestationHashBigInt, { value: sendValue2 });

            const totalLocked = await tokenBridge.lockedTokens(
                user1.address,
                attestationHashBigInt
            );
            expect(totalLocked).to.equal(sendValue1 + sendValue2);
        });

        it('Should revert if total locked exceeds MAX_MAGNITUDE', async function () {
            const { tokenBridge, user1 } = await deployTokenBridgeFixture();

            const weiPerBridgeUnit = await tokenBridge.WEI_PER_BRIDGE_UNIT();
            const maxMagnitude = await tokenBridge.MAX_MAGNITUDE();

            const hugeValue = (maxMagnitude + 1n) * weiPerBridgeUnit;
            await expect(
                tokenBridge
                    .connect(user1)
                    .lockTokens(attestationHashBigInt, { value: hugeValue })
            ).to.be.revertedWithCustomError(tokenBridge, 'TotalLockedOverflow');
        });
    });

    // -----------------------------------------------------------
    // withdrawFees
    // -----------------------------------------------------------
    describe('withdrawFees', function () {
        it('Should allow feeRecipient to withdraw accumulated fees', async function () {
            const { tokenBridge, owner, user1, treasury } = await deployTokenBridgeFixture();

            // Setup: set fee and recipient
            await tokenBridge.connect(owner).setLockFeeBps(100); // 0.1%
            await tokenBridge.connect(owner).setFeeRecipient(treasury.address);

            // Lock tokens to accumulate fees
            const sendValue = ethers.parseEther('10.0');
            const expectedFee = sendValue * 100n / 100000n; // 0.01 ETH

            await tokenBridge.connect(user1).lockTokens(attestationHashBigInt, { value: sendValue });

            expect(await tokenBridge.accumulatedFees()).to.equal(expectedFee);

            // Withdraw fees
            const treasuryBalBefore = await ethers.provider.getBalance(treasury.address);
            const tx = await tokenBridge.connect(treasury).withdrawFees();
            const receipt = await tx.wait();
            if (!receipt) throw new Error('Tx not mined');
            const gasUsed = receipt.gasUsed * receipt.gasPrice;
            const treasuryBalAfter = await ethers.provider.getBalance(treasury.address);

            // Treasury received fees minus gas
            expect(treasuryBalAfter - treasuryBalBefore + gasUsed).to.equal(expectedFee);

            // accumulatedFees reset to 0
            expect(await tokenBridge.accumulatedFees()).to.equal(0n);
        });

        it('Should emit FeesWithdrawn event', async function () {
            const { tokenBridge, owner, user1, treasury } = await deployTokenBridgeFixture();

            await tokenBridge.connect(owner).setLockFeeBps(50);
            await tokenBridge.connect(owner).setFeeRecipient(treasury.address);

            const sendValue = ethers.parseEther('2.0');
            const expectedFee = sendValue * 50n / 100000n;

            await tokenBridge.connect(user1).lockTokens(attestationHashBigInt, { value: sendValue });

            await expect(tokenBridge.connect(treasury).withdrawFees())
                .to.emit(tokenBridge, 'FeesWithdrawn')
                .withArgs(treasury.address, expectedFee);
        });

        it('Should revert if caller is not feeRecipient', async function () {
            const { tokenBridge, owner, user1, treasury } = await deployTokenBridgeFixture();

            await tokenBridge.connect(owner).setLockFeeBps(100);
            await tokenBridge.connect(owner).setFeeRecipient(treasury.address);
            await tokenBridge.connect(user1).lockTokens(attestationHashBigInt, {
                value: ethers.parseEther('1.0'),
            });

            await expect(
                tokenBridge.connect(user1).withdrawFees()
            ).to.be.revertedWithCustomError(tokenBridge, 'NotFeeRecipient');
        });

        it('Should revert if feeRecipient is not set', async function () {
            const { tokenBridge, owner } = await deployTokenBridgeFixture();

            await expect(
                tokenBridge.connect(owner).withdrawFees()
            ).to.be.revertedWithCustomError(tokenBridge, 'FeeRecipientNotSet');
        });

        it('Should revert if no fees accumulated', async function () {
            const { tokenBridge, owner, treasury } = await deployTokenBridgeFixture();

            await tokenBridge.connect(owner).setFeeRecipient(treasury.address);

            await expect(
                tokenBridge.connect(treasury).withdrawFees()
            ).to.be.revertedWithCustomError(tokenBridge, 'NoFeesToWithdraw');
        });
    });

    // -----------------------------------------------------------
    // calcGrossLockAmount (view helper)
    // -----------------------------------------------------------
    describe('calcGrossLockAmount', function () {
        it('Should return identity when fee is 0%', async function () {
            const { tokenBridge } = await deployTokenBridgeFixture();

            const desiredNet = ethers.parseEther('1.0');
            const [grossAmount, fee] = await tokenBridge.calcGrossLockAmount(desiredNet);

            expect(grossAmount).to.equal(desiredNet);
            expect(fee).to.equal(0n);
        });

        it('Should compute correct gross amount for various fee rates', async function () {
            const { tokenBridge, owner } = await deployTokenBridgeFixture();

            // Test at 100 bps (0.1%)
            await tokenBridge.connect(owner).setLockFeeBps(100);
            const desiredNet = ethers.parseEther('1.0');
            const [grossAmount, fee] = await tokenBridge.calcGrossLockAmount(desiredNet);

            // Verify: grossAmount - (grossAmount * 100 / 100000) >= desiredNet
            const actualFee = (grossAmount * 100n) / 100000n;
            const actualNet = grossAmount - actualFee;
            expect(actualNet).to.be.gte(desiredNet);
            expect(fee).to.equal(grossAmount - desiredNet);
        });

        it('Should produce a usable gross estimate for fee-aligned amounts', async function () {
            const { tokenBridge, owner, user1 } = await deployTokenBridgeFixture();

            // Use 1000 bps (1%) — produces clean results for round ETH amounts
            // 0.99 ETH desired net → gross = 1.0 ETH exactly
            // fee = 1.0 ETH * 1000 / 100000 = 0.01 ETH, net = 0.99 ETH (aligned)
            await tokenBridge.connect(owner).setLockFeeBps(1000);

            const desiredNet = ethers.parseEther('0.99');
            const [grossAmount, _fee] = await tokenBridge.calcGrossLockAmount(desiredNet);

            // Verify the gross produces the expected fee deduction
            const actualFee = (grossAmount * 1000n) / 100000n;
            const actualNet = grossAmount - actualFee;
            expect(actualNet).to.be.gte(desiredNet);

            // Verify the gross works with lockTokens
            await tokenBridge
                .connect(user1)
                .lockTokens(attestationHashBigInt, { value: grossAmount });

            const locked = await tokenBridge.lockedTokens(user1.address, attestationHashBigInt);
            expect(locked).to.be.gte(desiredNet);
        });
    });

    // -----------------------------------------------------------
    // setAlignedContracts
    // -----------------------------------------------------------
    describe('setAlignedContracts', function () {
        it('Should revert if non-operator calls setAlignedContracts', async function () {
            const { tokenBridge, user1, dummyState, dummyAccount } = await deployTokenBridgeFixture();

            await expect(
                tokenBridge.connect(user1).setAlignedContracts(dummyState.address, dummyAccount.address)
            ).to.be.revertedWithCustomError(tokenBridge, 'NotBridgeOperator');
        });

        it('Should revert if state settlement address is zero', async function () {
            const { tokenBridge, owner, dummyAccount } = await deployTokenBridgeFixture();

            await expect(
                tokenBridge.connect(owner).setAlignedContracts(ethers.ZeroAddress, dummyAccount.address)
            ).to.be.revertedWithCustomError(tokenBridge, 'ZeroAddress');
        });

        it('Should revert if account validation address is zero', async function () {
            const { tokenBridge, owner, dummyState } = await deployTokenBridgeFixture();

            await expect(
                tokenBridge.connect(owner).setAlignedContracts(dummyState.address, ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(tokenBridge, 'ZeroAddress');
        });

        it('Should emit events when aligned contracts are set', async function () {
            const [owner, dummyState, dummyAccount] = await ethers.getSigners();
            const TokenBridge = new NoriTokenBridge__factory(owner);
            const tokenBridge = await TokenBridge.deploy(owner.address);

            await expect(
                tokenBridge.connect(owner).setAlignedContracts(dummyState.address, dummyAccount.address)
            )
                .to.emit(tokenBridge, 'StateSettlementSet')
                .withArgs(dummyState.address)
                .and.to.emit(tokenBridge, 'AccountValidationSet')
                .withArgs(dummyAccount.address);
        });
    });

    // -----------------------------------------------------------
    // isConfigured
    // -----------------------------------------------------------
    describe('isConfigured', function () {
        it('Should return false before aligned contracts are set', async function () {
            const [owner] = await ethers.getSigners();
            const TokenBridge = new NoriTokenBridge__factory(owner);
            const tokenBridge = await TokenBridge.deploy(owner.address);

            expect(await tokenBridge.isConfigured()).to.equal(false);
        });

        it('Should return true after aligned contracts are set', async function () {
            const { tokenBridge } = await deployTokenBridgeFixture();
            expect(await tokenBridge.isConfigured()).to.equal(true);
        });

        it('Should revert lockTokens when not configured', async function () {
            const [owner] = await ethers.getSigners();
            const TokenBridge = new NoriTokenBridge__factory(owner);
            const tokenBridge = await TokenBridge.deploy(owner.address);

            await expect(
                tokenBridge.connect(owner).lockTokens(attestationHashBigInt, {
                    value: ethers.parseEther('1.0'),
                })
            ).to.be.revertedWithCustomError(tokenBridge, 'AlignedContractsNotConfigured');
        });
    });
});
