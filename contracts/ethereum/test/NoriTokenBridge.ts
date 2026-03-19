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

const WEI_PER_BRIDGE_UNIT = 10n ** 12n;

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

        it('Should have MIN_LOCK_AMOUNT of 0.0001 ETH', async function () {
            const { tokenBridge } = await deployTokenBridgeFixture();
            expect(await tokenBridge.MIN_LOCK_AMOUNT_WEI()).to.equal(100n * WEI_PER_BRIDGE_UNIT);
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
        it('Should allow users to lock tokens and store bridge units (BigInt)', async function () {
            const { tokenBridge, owner } = await deployTokenBridgeFixture();

            const sendValue = ethers.parseEther('1.0');
            const expectedBU = sendValue / WEI_PER_BRIDGE_UNIT; // 1_000_000

            await tokenBridge
                .connect(owner)
                .lockTokens(attestationHashBigInt, { value: sendValue });

            const locked = await tokenBridge.lockedTokens(
                owner.address,
                attestationHashBigInt
            );
            expect(locked).to.equal(expectedBU);
        });

        it('Should allow users to lock tokens and store bridge units (hex string)', async function () {
            const { tokenBridge, owner } = await deployTokenBridgeFixture();

            const sendValue = ethers.parseEther('1.0');
            const expectedBU = sendValue / WEI_PER_BRIDGE_UNIT;

            await tokenBridge
                .connect(owner)
                .lockTokens(attestationHashHex, { value: sendValue });

            const locked = await tokenBridge.lockedTokens(
                owner.address,
                attestationHashHex
            );
            expect(locked).to.equal(expectedBU);
        });

        it('Should emit TokensLocked event with wei amounts and zero fee at 0% (BigInt)', async function () {
            const { tokenBridge, owner } = await deployTokenBridgeFixture();
            const sendValue = ethers.parseEther('0.5');

            const tx = await tokenBridge
                .connect(owner)
                .lockTokens(attestationHashBigInt, { value: sendValue });
            const receipt = await tx.wait();
            if (!receipt) throw new Error('Transaction was not mined in time');

            const block = await ethers.provider.getBlock(receipt.blockNumber);
            if (!block) throw new Error(`Block ${receipt.blockNumber} not found`);

            // Events emit wei amounts
            await expect(tx)
                .to.emit(tokenBridge, 'TokensLocked')
                .withArgs(
                    owner.address,
                    attestationHashHex,
                    sendValue, // netWei = msg.value at 0% fee
                    0n, // feeWei = 0 at 0%
                    block.timestamp
                );
        });

        it('Should revert if below MIN_LOCK_AMOUNT', async function () {
            const { tokenBridge, owner } = await deployTokenBridgeFixture();

            await expect(
                tokenBridge
                    .connect(owner)
                    .lockTokens(attestationHashBigInt, { value: 0n })
            ).to.be.revertedWithCustomError(tokenBridge, 'BelowMinLockAmount');
        });

        it('Should revert if below MIN_LOCK_AMOUNT (dust)', async function () {
            const { tokenBridge, owner } = await deployTokenBridgeFixture();

            // Send 99 bridge units = 0.000099 ETH (below 0.0001 ETH minimum)
            const dustAmount = 99n * WEI_PER_BRIDGE_UNIT;

            await expect(
                tokenBridge
                    .connect(owner)
                    .lockTokens(attestationHashBigInt, { value: dustAmount })
            ).to.be.revertedWithCustomError(tokenBridge, 'BelowMinLockAmount');
        });

        it('Should succeed at exactly MIN_LOCK_AMOUNT', async function () {
            const { tokenBridge, owner } = await deployTokenBridgeFixture();

            const minAmount = 100n * WEI_PER_BRIDGE_UNIT; // 0.0001 ETH

            await tokenBridge
                .connect(owner)
                .lockTokens(attestationHashBigInt, { value: minAmount });

            const locked = await tokenBridge.lockedTokens(owner.address, attestationHashBigInt);
            expect(locked).to.equal(100n); // 100 bridge units
        });

        it('Should allow multiple locks from same address', async function () {
            const { tokenBridge, owner } = await deployTokenBridgeFixture();

            const value1 = ethers.parseEther('0.2');
            const value2 = ethers.parseEther('0.8');
            const expectedBU = (value1 + value2) / WEI_PER_BRIDGE_UNIT;

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
            expect(total).to.equal(expectedBU);
        });
    });

    // -----------------------------------------------------------
    // Locking Tokens with Fees
    // -----------------------------------------------------------
    describe('Locking Tokens (with fee)', function () {
        it('Should deduct fee and store only net bridge units in lockedTokens', async function () {
            const { tokenBridge, owner, user1 } = await deployTokenBridgeFixture();

            // Set 500 bps = 0.5% lock fee
            await tokenBridge.connect(owner).setLockFeeBps(500);

            const sendValue = ethers.parseEther('1.0'); // 1 ETH = 1_000_000 BU
            // feeBU = 1_000_000 * 500 / 100000 = 5000
            // netBU = 1_000_000 - 5000 = 995000
            // feeWei = 5000 * 10^12 = 5 * 10^15
            const grossBU = sendValue / WEI_PER_BRIDGE_UNIT;
            const feeBU = grossBU * 500n / 100000n;
            const netBU = grossBU - feeBU;
            const feeWei = feeBU * WEI_PER_BRIDGE_UNIT;

            await tokenBridge
                .connect(user1)
                .lockTokens(attestationHashBigInt, { value: sendValue });

            // lockedTokens should have net bridge units
            const locked = await tokenBridge.lockedTokens(user1.address, attestationHashBigInt);
            expect(locked).to.equal(netBU);

            // accumulatedFees should have fee in wei
            const fees = await tokenBridge.accumulatedFees();
            expect(fees).to.equal(feeWei);
        });

        it('Should update totalLocked based on net bridge units', async function () {
            const { tokenBridge, owner, user1 } = await deployTokenBridgeFixture();

            await tokenBridge.connect(owner).setLockFeeBps(500); // 0.5%

            const sendValue = ethers.parseEther('1.0');
            const grossBU = sendValue / WEI_PER_BRIDGE_UNIT;
            const feeBU = grossBU * 500n / 100000n;
            const netBU = grossBU - feeBU;

            await tokenBridge
                .connect(user1)
                .lockTokens(attestationHashBigInt, { value: sendValue });

            const totalLocked = await tokenBridge.totalLocked();
            expect(totalLocked).to.equal(netBU);
        });

        it('Should emit TokensLocked with wei amounts', async function () {
            const { tokenBridge, owner, user1 } = await deployTokenBridgeFixture();

            await tokenBridge.connect(owner).setLockFeeBps(1000); // 1%

            const sendValue = ethers.parseEther('2.0'); // 2_000_000 BU
            const grossBU = sendValue / WEI_PER_BRIDGE_UNIT;
            const feeBU = grossBU * 1000n / 100000n; // 20000
            const netBU = grossBU - feeBU; // 1980000
            const feeWei = feeBU * WEI_PER_BRIDGE_UNIT;
            const netWei = netBU * WEI_PER_BRIDGE_UNIT;

            const tx = await tokenBridge
                .connect(user1)
                .lockTokens(attestationHashBigInt, { value: sendValue });
            const receipt = await tx.wait();
            if (!receipt) throw new Error('Tx not mined');
            const block = await ethers.provider.getBlock(receipt.blockNumber);
            if (!block) throw new Error('Block not found');

            // Events emit wei amounts
            await expect(tx)
                .to.emit(tokenBridge, 'TokensLocked')
                .withArgs(
                    user1.address,
                    attestationHashBigInt,
                    netWei,
                    feeWei,
                    block.timestamp
                );
        });

        it('Should revert if msg.value is not bridge-unit-aligned', async function () {
            const { tokenBridge, owner, user1 } = await deployTokenBridgeFixture();

            // msg.value must be bridge-unit-aligned (checked BEFORE fee deduction)
            const minLockAmount = await tokenBridge.MIN_LOCK_AMOUNT_WEI();
            const unalignedAmount = minLockAmount + 1n; // not a multiple of WEI_PER_BRIDGE_UNIT

            await expect(
                tokenBridge
                    .connect(user1)
                    .lockTokens(attestationHashBigInt, { value: unalignedAmount })
            ).to.be.revertedWithCustomError(tokenBridge, 'InvalidBridgeUnitMultiple');
        });

        it('Should round up fee to MIN_FEE_BU when computed fee is below minimum', async function () {
            const { tokenBridge, owner, user1 } = await deployTokenBridgeFixture();

            // Set 1 bps = 0.001% fee
            await tokenBridge.connect(owner).setLockFeeBps(1);

            // Send MIN_LOCK_AMOUNT = 100 bridge units
            // feeBU = 100 * 1 / 100000 = 0 (truncated) → rounds up to MIN_FEE_BU = 10
            // netBU = 100 - 10 = 90
            const minAmount = 100n * WEI_PER_BRIDGE_UNIT;

            await tokenBridge
                .connect(user1)
                .lockTokens(attestationHashBigInt, { value: minAmount });

            const locked = await tokenBridge.lockedTokens(user1.address, attestationHashBigInt);
            expect(locked).to.equal(90n); // 90 bridge units (10 taken as MIN_FEE_BU)

            const fees = await tokenBridge.accumulatedFees();
            expect(fees).to.equal(10n * WEI_PER_BRIDGE_UNIT); // MIN_FEE_BU in wei
        });

        it('Should handle fee rates that produce non-zero fees', async function () {
            const { tokenBridge, owner, user1 } = await deployTokenBridgeFixture();

            // Set 1000 bps = 1%
            // For 1 ETH (1_000_000 BU): feeBU = 1_000_000 * 1000 / 100000 = 10000
            // netBU = 990000
            // feeWei = 10000 * 10^12 = 10^16 = 0.01 ETH
            await tokenBridge.connect(owner).setLockFeeBps(1000);

            const sendValue = ethers.parseEther('1.0');
            const grossBU = sendValue / WEI_PER_BRIDGE_UNIT;
            const feeBU = grossBU * 1000n / 100000n;
            const netBU = grossBU - feeBU;
            const feeWei = feeBU * WEI_PER_BRIDGE_UNIT;

            await tokenBridge
                .connect(user1)
                .lockTokens(attestationHashBigInt, { value: sendValue });

            const locked = await tokenBridge.lockedTokens(user1.address, attestationHashBigInt);
            expect(locked).to.equal(netBU);

            const fees = await tokenBridge.accumulatedFees();
            expect(fees).to.equal(feeWei);
        });

        it('Should accumulate fees across multiple locks', async function () {
            const { tokenBridge, owner, user1 } = await deployTokenBridgeFixture();

            await tokenBridge.connect(owner).setLockFeeBps(1000); // 1%

            const value1 = ethers.parseEther('1.0');
            const value2 = ethers.parseEther('2.0');
            const feeBU1 = (value1 / WEI_PER_BRIDGE_UNIT) * 1000n / 100000n;
            const feeBU2 = (value2 / WEI_PER_BRIDGE_UNIT) * 1000n / 100000n;
            const totalFeeWei = (feeBU1 + feeBU2) * WEI_PER_BRIDGE_UNIT;

            await tokenBridge.connect(user1).lockTokens(attestationHashBigInt, { value: value1 });
            await tokenBridge.connect(user1).lockTokens(attestationHashBigInt, { value: value2 });

            const fees = await tokenBridge.accumulatedFees();
            expect(fees).to.equal(totalFeeWei);
        });
    });

    // -----------------------------------------------------------
    // Bridge Unit / v2Rpc Tests
    // -----------------------------------------------------------
    describe('v2Rpc Tests', function () {
        it('Should convert wei to bridge units and update totalLocked correctly', async function () {
            const { tokenBridge, user1 } = await deployTokenBridgeFixture();

            const sendValue = ethers.parseEther('1.0');
            const expectedBridgeUnits = sendValue / WEI_PER_BRIDGE_UNIT;

            await tokenBridge
                .connect(user1)
                .lockTokens(attestationHashBigInt, { value: sendValue });

            const totalLocked = await tokenBridge.totalLocked();
            expect(totalLocked).to.equal(expectedBridgeUnits);
        });

        it('Should revert if value is not a multiple of bridge unit', async function () {
            const { tokenBridge, user1 } = await deployTokenBridgeFixture();

            // Must be >= MIN_LOCK_AMOUNT AND not aligned
            const invalidAmount = 100n * WEI_PER_BRIDGE_UNIT + 1n;
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
            const expectedBU = (sendValue1 + sendValue2) / WEI_PER_BRIDGE_UNIT;

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
            expect(totalLocked).to.equal(expectedBU);
        });

        it('Should revert if total locked exceeds MAX_MAGNITUDE', async function () {
            const { tokenBridge, user1 } = await deployTokenBridgeFixture();

            const maxMagnitude = await tokenBridge.MAX_MAGNITUDE();

            const hugeValue = (maxMagnitude + 1n) * WEI_PER_BRIDGE_UNIT;
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
            await tokenBridge.connect(owner).setLockFeeBps(1000); // 1%
            await tokenBridge.connect(owner).setFeeRecipient(treasury.address);

            // Lock tokens to accumulate fees
            const sendValue = ethers.parseEther('10.0'); // 10_000_000 BU
            const feeBU = (sendValue / WEI_PER_BRIDGE_UNIT) * 1000n / 100000n; // 100000 BU
            const expectedFeeWei = feeBU * WEI_PER_BRIDGE_UNIT; // 0.1 ETH

            await tokenBridge.connect(user1).lockTokens(attestationHashBigInt, { value: sendValue });

            expect(await tokenBridge.accumulatedFees()).to.equal(expectedFeeWei);

            // Withdraw fees
            const treasuryBalBefore = await ethers.provider.getBalance(treasury.address);
            const tx = await tokenBridge.connect(treasury).withdrawFees();
            const receipt = await tx.wait();
            if (!receipt) throw new Error('Tx not mined');
            const gasUsed = receipt.gasUsed * receipt.gasPrice;
            const treasuryBalAfter = await ethers.provider.getBalance(treasury.address);

            // Treasury received fees minus gas
            expect(treasuryBalAfter - treasuryBalBefore + gasUsed).to.equal(expectedFeeWei);

            // accumulatedFees reset to 0
            expect(await tokenBridge.accumulatedFees()).to.equal(0n);
        });

        it('Should emit FeesWithdrawn event', async function () {
            const { tokenBridge, owner, user1, treasury } = await deployTokenBridgeFixture();

            await tokenBridge.connect(owner).setLockFeeBps(500); // 0.5%
            await tokenBridge.connect(owner).setFeeRecipient(treasury.address);

            const sendValue = ethers.parseEther('2.0'); // 2_000_000 BU
            const feeBU = (sendValue / WEI_PER_BRIDGE_UNIT) * 500n / 100000n; // 10000 BU
            const expectedFeeWei = feeBU * WEI_PER_BRIDGE_UNIT;

            await tokenBridge.connect(user1).lockTokens(attestationHashBigInt, { value: sendValue });

            await expect(tokenBridge.connect(treasury).withdrawFees())
                .to.emit(tokenBridge, 'FeesWithdrawn')
                .withArgs(treasury.address, expectedFeeWei);
        });

        it('Should revert if caller is not feeRecipient', async function () {
            const { tokenBridge, owner, user1, treasury } = await deployTokenBridgeFixture();

            await tokenBridge.connect(owner).setLockFeeBps(1000);
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

            // Test at 1000 bps (1%)
            await tokenBridge.connect(owner).setLockFeeBps(1000);
            const desiredNet = ethers.parseEther('1.0');
            const [grossAmount, fee] = await tokenBridge.calcGrossLockAmount(desiredNet);

            // Verify using bridge unit math (same as contract)
            const grossBU = grossAmount / WEI_PER_BRIDGE_UNIT;
            const feeBU = grossBU * 1000n / 100000n;
            const netBU = grossBU - feeBU;
            const desiredNetBU = desiredNet / WEI_PER_BRIDGE_UNIT;

            expect(netBU).to.be.gte(desiredNetBU);
            expect(fee).to.equal(grossAmount - desiredNet);
        });

        it('Should produce a usable gross estimate for fee-aligned amounts', async function () {
            const { tokenBridge, owner, user1 } = await deployTokenBridgeFixture();

            // Use 1000 bps (1%)
            // 0.99 ETH desired net = 990000 BU
            // grossBU = ceil(990000 * 100000 / 99000) = 1000000
            // grossAmount = 1 ETH exactly
            await tokenBridge.connect(owner).setLockFeeBps(1000);

            const desiredNet = ethers.parseEther('0.99');
            const desiredNetBU = desiredNet / WEI_PER_BRIDGE_UNIT;
            const [grossAmount, _fee] = await tokenBridge.calcGrossLockAmount(desiredNet);

            // Verify the gross works with lockTokens
            await tokenBridge
                .connect(user1)
                .lockTokens(attestationHashBigInt, { value: grossAmount });

            // lockedTokens returns bridge units
            const locked = await tokenBridge.lockedTokens(user1.address, attestationHashBigInt);
            expect(locked).to.be.gte(desiredNetBU);
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
