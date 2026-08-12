/// <reference types="@nomicfoundation/hardhat-ethers" />
/// <reference types="@nomicfoundation/hardhat-ethers-chai-matchers" />
import { expect } from 'chai';
import { getRandomValues } from 'crypto';
import {
    NoriProofRequestQueue__factory,
    NoriTokenBridge__factory,
} from 'types/ethers-contracts/index.js';
import hre from 'hardhat';
const { ethers } = await hre.network.getOrCreate();

const codeChallengeBytes = new Uint8Array(32);
getRandomValues(codeChallengeBytes);
const codeChallengeBigInt = codeChallengeBytes.reduce(
    (acc, byte) => (acc << 8n) + BigInt(byte),
    0n
);
const codeChallengeHex = `0x${Array.from(codeChallengeBytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;

console.log('codeChallengeBigInt', codeChallengeBigInt);
console.log('codeChallengeHex', codeChallengeHex);

const WEI_PER_BRIDGE_UNIT = 10n ** 12n;
/// Storage slot index of `lockedTokens`, mirrored by the SP1 guest program.
const LOCKED_TOKENS_SLOT_INDEX = 2n;
/// Per-request queue fee used by the queue-fee test blocks. 0.0002 ETH,
/// matching the deployment default.
const PROOF_REQUEST_QUEUE_FEE = 200n * WEI_PER_BRIDGE_UNIT;
const ZKAPP_ACCT_TOKEN_ID =
    '0x1b848805a3db129b6b41adca52c9b6f380d58dc9c283f73ce17466a01b90d361';
const ZKAPP_ACCT_VERIFICATION_KEY_HASH =
    '0xdc9c283f73ce17466a01b90d36141b848805a3db129b6b80d581adca52c9b6f3';

/**
 * Deploy a proof request queue and return its address.
 *
 * Deposits enqueue a storage-proof request on every lock, so the bridge needs
 * a queue to point at. Unless a test is exercising the proof request queue fee itself the
 * queue is deployed with `proofRequestQueueFee = 0`, under which the bridge's fee
 * arithmetic reduces exactly to its pre-queue behaviour — which is what lets
 * the suite below stand as a regression check.
 */
async function deployProofQueueAddress(proofRequestQueueFee = 0n): Promise<string> {
    const [deployer, , , , , treasury] = await ethers.getSigners();
    const Queue = new NoriProofRequestQueue__factory(deployer);
    const queue = await Queue.deploy(
        deployer.address,
        treasury.address,
        proofRequestQueueFee
    );
    return queue.getAddress();
}

describe('NoriTokenBridge', () => {
    async function deployTokenBridgeFixture(proofRequestQueueFee = 0n) {
        const [owner, user1, user2, dummyState, dummyAccount, treasury] = await ethers.getSigners();

        const Queue = new NoriProofRequestQueue__factory(owner);
        const proofQueue = await Queue.deploy(
            owner.address,
            treasury.address,
            proofRequestQueueFee
        );

        const TokenBridge = new NoriTokenBridge__factory(owner);

        // Constructor now requires explicit bridgeOperator, proof queue, zkApp tokenID, and (optional) feeRecipient
        const tokenBridge = await TokenBridge.deploy(
            owner.address,
            dummyState.address,
            dummyAccount.address,
            await proofQueue.getAddress(),
            ZKAPP_ACCT_TOKEN_ID,
            ZKAPP_ACCT_VERIFICATION_KEY_HASH,
            ethers.ZeroAddress
        );

        // Configure with dummy aligned contract addresses so onlyConfigured passes
        await tokenBridge.setAlignedContracts(dummyState.address, dummyAccount.address);

        return { tokenBridge, proofQueue, owner, user1, user2, dummyState, dummyAccount, treasury };
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
            const tokenBridge = await TokenBridge.deploy(
                operator.address,
                dummyState.address,
                dummyAccount.address,
                await deployProofQueueAddress(),
                ZKAPP_ACCT_TOKEN_ID,
                ZKAPP_ACCT_VERIFICATION_KEY_HASH,
                ethers.ZeroAddress
            );

            expect(await tokenBridge.bridgeOperator()).equals(operator.address);

            // deployer should NOT be able to call admin functions
            await expect(
                tokenBridge.connect(deployer).setAlignedContracts(dummyState.address, dummyAccount.address)
            ).to.be.revertedWithCustomError(tokenBridge, 'NotBridgeOperator');

            // operator should be able to
            await tokenBridge.connect(operator).setAlignedContracts(dummyState.address, dummyAccount.address);
        });

        it('Should revert if bridgeOperator is zero address', async function () {
            const [deployer, dummyState, dummyAccount] = await ethers.getSigners();
            const TokenBridge = new NoriTokenBridge__factory(deployer);
            await expect(
                TokenBridge.deploy(
                    ethers.ZeroAddress,
                    dummyState.address,
                    dummyAccount.address,
                    await deployProofQueueAddress(),
                    ZKAPP_ACCT_TOKEN_ID,
                    ZKAPP_ACCT_VERIFICATION_KEY_HASH,
                    ethers.ZeroAddress
                )
            ).to.be.revertedWithCustomError(TokenBridge, 'ZeroAddress');
        });

        it('Should deploy with zero balance (non-payable constructor)', async function () {
            const [deployer, dummyState, dummyAccount] = await ethers.getSigners();
            const TokenBridge = new NoriTokenBridge__factory(deployer);
            const tokenBridge = await TokenBridge.deploy(
                deployer.address,
                dummyState.address,
                dummyAccount.address,
                await deployProofQueueAddress(),
                ZKAPP_ACCT_TOKEN_ID,
                ZKAPP_ACCT_VERIFICATION_KEY_HASH,
                ethers.ZeroAddress
            );
            const balance = await ethers.provider.getBalance(tokenBridge.target);
            expect(balance).to.equal(0n);
        });

        it('Should initialize fees to zero', async function () {
            const { tokenBridge } = await deployTokenBridgeFixture();
            expect(await tokenBridge.lockFeeRate()).to.equal(0);
            expect(await tokenBridge.unlockFeeRate()).to.equal(0);
            expect(await tokenBridge.accumulatedFees()).to.equal(0n);
            expect(await tokenBridge.feeRecipient()).to.equal(ethers.ZeroAddress);
        });

        it('Should set NORI_BRIDGE_ZKAPP_ACCT_TOKEN_ID from constructor', async function () {
            const { tokenBridge } = await deployTokenBridgeFixture();
            expect(await tokenBridge.NORI_BRIDGE_ZKAPP_ACCT_TOKEN_ID()).to.equal(ZKAPP_ACCT_TOKEN_ID);
        });

        it('Should set NORI_STORAGE_ZKAPP_ACCT_VERIFICATION_KEY_HASH from constructor', async function () {
            const { tokenBridge } = await deployTokenBridgeFixture();
            expect(await tokenBridge.NORI_STORAGE_ZKAPP_ACCT_VERIFICATION_KEY_HASH()).to.equal(
                ZKAPP_ACCT_VERIFICATION_KEY_HASH
            );
        });

        it('Should set feeRecipient from constructor when non-zero', async function () {
            const [deployer, dummyState, dummyAccount, treasury] = await ethers.getSigners();
            const TokenBridge = new NoriTokenBridge__factory(deployer);
            const tokenBridge = await TokenBridge.deploy(
                deployer.address,
                dummyState.address,
                dummyAccount.address,
                await deployProofQueueAddress(),
                ZKAPP_ACCT_TOKEN_ID,
                ZKAPP_ACCT_VERIFICATION_KEY_HASH,
                treasury.address
            );
            expect(await tokenBridge.feeRecipient()).to.equal(treasury.address);
        });

        it('Should emit FeeRecipientSet at deployment when non-zero recipient is provided', async function () {
            const [deployer, dummyState, dummyAccount, treasury] = await ethers.getSigners();
            const TokenBridge = new NoriTokenBridge__factory(deployer);
            const tokenBridge = await TokenBridge.deploy(
                deployer.address,
                dummyState.address,
                dummyAccount.address,
                await deployProofQueueAddress(),
                ZKAPP_ACCT_TOKEN_ID,
                ZKAPP_ACCT_VERIFICATION_KEY_HASH,
                treasury.address
            );
            const deployTx = tokenBridge.deploymentTransaction();
            if (!deployTx) throw new Error('No deployment tx');
            await expect(deployTx)
                .to.emit(tokenBridge, 'FeeRecipientSet')
                .withArgs(ethers.ZeroAddress, treasury.address);
        });

        it('Should leave feeRecipient unset when constructor passes zero address', async function () {
            const { tokenBridge } = await deployTokenBridgeFixture();
            expect(await tokenBridge.feeRecipient()).to.equal(ethers.ZeroAddress);
        });

        it('Should have MIN_LOCK_AMOUNT of 0.001 ETH', async function () {
            const { tokenBridge } = await deployTokenBridgeFixture();
            expect(await tokenBridge.MIN_LOCK_AMOUNT_WEI()).to.equal(1000n * WEI_PER_BRIDGE_UNIT);
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
        it('Should allow operator to set lock fee rate and emit event', async function () {
            const { tokenBridge, owner } = await deployTokenBridgeFixture();

            await expect(tokenBridge.connect(owner).setLockFeeRate(50))
                .to.emit(tokenBridge, 'LockFeeRateSet')
                .withArgs(0, 50);

            expect(await tokenBridge.lockFeeRate()).to.equal(50);
        });

        it('Should allow operator to set unlock fee rate and emit event', async function () {
            const { tokenBridge, owner } = await deployTokenBridgeFixture();

            await expect(tokenBridge.connect(owner).setUnlockFeeRate(100))
                .to.emit(tokenBridge, 'UnlockFeeRateSet')
                .withArgs(0, 100);

            expect(await tokenBridge.unlockFeeRate()).to.equal(100);
        });

        it('Should revert if lock fee exceeds MAX_FEE_RATE', async function () {
            const { tokenBridge, owner } = await deployTokenBridgeFixture();
            const maxFeeRate = Number(await tokenBridge.MAX_FEE_RATE());

            await expect(
                tokenBridge.connect(owner).setLockFeeRate(maxFeeRate + 1)
            ).to.be.revertedWithCustomError(tokenBridge, 'FeeRateTooHigh');
        });

        it('Should revert if unlock fee exceeds MAX_FEE_RATE', async function () {
            const { tokenBridge, owner } = await deployTokenBridgeFixture();
            const maxFeeRate = Number(await tokenBridge.MAX_FEE_RATE());

            await expect(
                tokenBridge.connect(owner).setUnlockFeeRate(maxFeeRate + 1)
            ).to.be.revertedWithCustomError(tokenBridge, 'FeeRateTooHigh');
        });

        it('Should allow setting fee at exactly MAX_FEE_RATE', async function () {
            const { tokenBridge, owner } = await deployTokenBridgeFixture();

            await tokenBridge.connect(owner).setLockFeeRate(10000);
            expect(await tokenBridge.lockFeeRate()).to.equal(10000);

            await tokenBridge.connect(owner).setUnlockFeeRate(10000);
            expect(await tokenBridge.unlockFeeRate()).to.equal(10000);
        });

        it('Should revert if non-operator sets lock fee', async function () {
            const { tokenBridge, user1 } = await deployTokenBridgeFixture();

            await expect(
                tokenBridge.connect(user1).setLockFeeRate(50)
            ).to.be.revertedWithCustomError(tokenBridge, 'NotBridgeOperator');
        });

        it('Should revert if non-operator sets unlock fee', async function () {
            const { tokenBridge, user1 } = await deployTokenBridgeFixture();

            await expect(
                tokenBridge.connect(user1).setUnlockFeeRate(50)
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

        it('MAX_FEE_RATE should equal 10000', async function () {
            const { tokenBridge } = await deployTokenBridgeFixture();
            expect(await tokenBridge.MAX_FEE_RATE()).to.equal(10000);
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
                .lockTokens(codeChallengeBigInt, { value: sendValue });

            const locked = await tokenBridge.lockedTokens(
                codeChallengeBigInt
            );
            expect(locked).to.equal(expectedBU);
        });

        it('Should allow users to lock tokens and store bridge units (hex string)', async function () {
            const { tokenBridge, owner } = await deployTokenBridgeFixture();

            const sendValue = ethers.parseEther('1.0');
            const expectedBU = sendValue / WEI_PER_BRIDGE_UNIT;

            await tokenBridge
                .connect(owner)
                .lockTokens(codeChallengeHex, { value: sendValue });

            const locked = await tokenBridge.lockedTokens(
                codeChallengeHex
            );
            expect(locked).to.equal(expectedBU);
        });

        it('Should emit TokensLocked event with wei amounts and zero fee at 0% (BigInt)', async function () {
            const { tokenBridge, owner } = await deployTokenBridgeFixture();
            const sendValue = ethers.parseEther('0.5');

            const tx = await tokenBridge
                .connect(owner)
                .lockTokens(codeChallengeBigInt, { value: sendValue });

            // Events emit wei amounts (no timestamp in event)
            await expect(tx)
                .to.emit(tokenBridge, 'TokensLocked')
                .withArgs(
                    owner.address,
                    codeChallengeHex,
                    sendValue, // netWei = msg.value at 0% fee
                    0n // feeWei = 0 at 0%
                );
        });

        it('Should revert if below MIN_LOCK_AMOUNT', async function () {
            const { tokenBridge, owner } = await deployTokenBridgeFixture();

            await expect(
                tokenBridge
                    .connect(owner)
                    .lockTokens(codeChallengeBigInt, { value: 0n })
            ).to.be.revertedWithCustomError(tokenBridge, 'BelowMinLockAmount');
        });

        it('Should revert if below MIN_LOCK_AMOUNT (dust)', async function () {
            const { tokenBridge, owner } = await deployTokenBridgeFixture();

            // Send 99 bridge units = 0.000099 ETH (below 0.0001 ETH minimum)
            const dustAmount = 99n * WEI_PER_BRIDGE_UNIT;

            await expect(
                tokenBridge
                    .connect(owner)
                    .lockTokens(codeChallengeBigInt, { value: dustAmount })
            ).to.be.revertedWithCustomError(tokenBridge, 'BelowMinLockAmount');
        });

        it('Should succeed at exactly MIN_LOCK_AMOUNT', async function () {
            const { tokenBridge, owner } = await deployTokenBridgeFixture();

            const minAmount = 1000n * WEI_PER_BRIDGE_UNIT; // 0.001 ETH

            await tokenBridge
                .connect(owner)
                .lockTokens(codeChallengeBigInt, { value: minAmount });

            const locked = await tokenBridge.lockedTokens(codeChallengeBigInt);
            expect(locked).to.equal(1000n); // 1000 bridge units
        });

        it('Should allow multiple locks from same address', async function () {
            const { tokenBridge, owner } = await deployTokenBridgeFixture();

            const value1 = ethers.parseEther('0.2');
            const value2 = ethers.parseEther('0.8');
            const expectedBU = (value1 + value2) / WEI_PER_BRIDGE_UNIT;

            await tokenBridge
                .connect(owner)
                .lockTokens(codeChallengeBigInt, { value: value1 });
            await tokenBridge
                .connect(owner)
                .lockTokens(codeChallengeBigInt, { value: value2 });

            const total = await tokenBridge.lockedTokens(
                codeChallengeBigInt
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

            // Set 500 rate units = 0.5% lock fee
            await tokenBridge.connect(owner).setLockFeeRate(500);

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
                .lockTokens(codeChallengeBigInt, { value: sendValue });

            // lockedTokens should have net bridge units
            const locked = await tokenBridge.lockedTokens(codeChallengeBigInt);
            expect(locked).to.equal(netBU);

            // accumulatedFees should have fee in wei
            const fees = await tokenBridge.accumulatedFees();
            expect(fees).to.equal(feeWei);
        });

        it('Should update totalLocked based on net bridge units', async function () {
            const { tokenBridge, owner, user1 } = await deployTokenBridgeFixture();

            await tokenBridge.connect(owner).setLockFeeRate(500); // 0.5%

            const sendValue = ethers.parseEther('1.0');
            const grossBU = sendValue / WEI_PER_BRIDGE_UNIT;
            const feeBU = grossBU * 500n / 100000n;
            const netBU = grossBU - feeBU;

            await tokenBridge
                .connect(user1)
                .lockTokens(codeChallengeBigInt, { value: sendValue });

            const totalLocked = await tokenBridge.totalLockedBU();
            expect(totalLocked).to.equal(netBU);
        });

        it('Should emit TokensLocked with wei amounts', async function () {
            const { tokenBridge, owner, user1 } = await deployTokenBridgeFixture();

            await tokenBridge.connect(owner).setLockFeeRate(1000); // 1%

            const sendValue = ethers.parseEther('2.0'); // 2_000_000 BU
            const grossBU = sendValue / WEI_PER_BRIDGE_UNIT;
            const feeBU = grossBU * 1000n / 100000n; // 20000
            const netBU = grossBU - feeBU; // 1980000
            const feeWei = feeBU * WEI_PER_BRIDGE_UNIT;
            const netWei = netBU * WEI_PER_BRIDGE_UNIT;

            const tx = await tokenBridge
                .connect(user1)
                .lockTokens(codeChallengeBigInt, { value: sendValue });

            // Events emit wei amounts (no timestamp in event)
            await expect(tx)
                .to.emit(tokenBridge, 'TokensLocked')
                .withArgs(
                    user1.address,
                    codeChallengeBigInt,
                    netWei,
                    feeWei
                );
        });

        it('Should revert if msg.value is not bridge-unit-aligned', async function () {
            const { tokenBridge, user1 } = await deployTokenBridgeFixture();

            // msg.value must be bridge-unit-aligned (checked BEFORE fee deduction)
            const minLockAmount = await tokenBridge.MIN_LOCK_AMOUNT_WEI();
            const unalignedAmount = minLockAmount + 1n; // not a multiple of WEI_PER_BRIDGE_UNIT

            await expect(
                tokenBridge
                    .connect(user1)
                    .lockTokens(codeChallengeBigInt, { value: unalignedAmount })
            ).to.be.revertedWithCustomError(tokenBridge, 'InvalidBridgeUnitMultiple');
        });

        it('Should round up fee to MIN_FEE_BU when computed fee is below minimum', async function () {
            const { tokenBridge, owner, user1 } = await deployTokenBridgeFixture();

            // Set 1 rate units = 0.001% fee
            await tokenBridge.connect(owner).setLockFeeRate(1);

            // Send MIN_LOCK_AMOUNT = 1000 bridge units
            // feeBU = 1000 * 1 / 100000 = 0 (truncated) → rounds up to MIN_FEE_BU = 10
            // netBU = 1000 - 10 = 990
            const minAmount = 1000n * WEI_PER_BRIDGE_UNIT;

            await tokenBridge
                .connect(user1)
                .lockTokens(codeChallengeBigInt, { value: minAmount });

            const locked = await tokenBridge.lockedTokens(codeChallengeBigInt);
            expect(locked).to.equal(990n); // 990 bridge units (10 taken as MIN_FEE_BU)

            const fees = await tokenBridge.accumulatedFees();
            expect(fees).to.equal(10n * WEI_PER_BRIDGE_UNIT); // MIN_FEE_BU in wei
        });

        it('Should handle fee rates that produce non-zero fees', async function () {
            const { tokenBridge, owner, user1 } = await deployTokenBridgeFixture();

            // Set 1000 rate units = 1%
            // For 1 ETH (1_000_000 BU): feeBU = 1_000_000 * 1000 / 100000 = 10000
            // netBU = 990000
            // feeWei = 10000 * 10^12 = 10^16 = 0.01 ETH
            await tokenBridge.connect(owner).setLockFeeRate(1000);

            const sendValue = ethers.parseEther('1.0');
            const grossBU = sendValue / WEI_PER_BRIDGE_UNIT;
            const feeBU = grossBU * 1000n / 100000n;
            const netBU = grossBU - feeBU;
            const feeWei = feeBU * WEI_PER_BRIDGE_UNIT;

            await tokenBridge
                .connect(user1)
                .lockTokens(codeChallengeBigInt, { value: sendValue });

            const locked = await tokenBridge.lockedTokens(codeChallengeBigInt);
            expect(locked).to.equal(netBU);

            const fees = await tokenBridge.accumulatedFees();
            expect(fees).to.equal(feeWei);
        });

        it('Should accumulate fees across multiple locks', async function () {
            const { tokenBridge, owner, user1 } = await deployTokenBridgeFixture();

            await tokenBridge.connect(owner).setLockFeeRate(1000); // 1%

            const value1 = ethers.parseEther('1.0');
            const value2 = ethers.parseEther('2.0');
            const feeBU1 = (value1 / WEI_PER_BRIDGE_UNIT) * 1000n / 100000n;
            const feeBU2 = (value2 / WEI_PER_BRIDGE_UNIT) * 1000n / 100000n;
            const totalFeeWei = (feeBU1 + feeBU2) * WEI_PER_BRIDGE_UNIT;

            await tokenBridge.connect(user1).lockTokens(codeChallengeBigInt, { value: value1 });
            await tokenBridge.connect(user1).lockTokens(codeChallengeBigInt, { value: value2 });

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
                .lockTokens(codeChallengeBigInt, { value: sendValue });

            const totalLocked = await tokenBridge.totalLockedBU();
            expect(totalLocked).to.equal(expectedBridgeUnits);
        });

        it('Should revert if value is not a multiple of bridge unit', async function () {
            const { tokenBridge, user1 } = await deployTokenBridgeFixture();

            // Must be >= MIN_LOCK_AMOUNT AND not aligned
            const invalidAmount = 1000n * WEI_PER_BRIDGE_UNIT + 1n;
            await expect(
                tokenBridge
                    .connect(user1)
                    .lockTokens(codeChallengeBigInt, { value: invalidAmount })
            ).to.be.revertedWithCustomError(tokenBridge, 'InvalidBridgeUnitMultiple');
        });

        it('Should allow different depositors to lock to the same codeChallenge and accumulate correctly', async function () {
            const { tokenBridge, user1, user2 } = await deployTokenBridgeFixture();
            const sendValue1 = ethers.parseEther('0.5');
            const sendValue2 = ethers.parseEther('1.0');
            const expectedBU = (sendValue1 + sendValue2) / WEI_PER_BRIDGE_UNIT;

            await tokenBridge
                .connect(user1)
                .lockTokens(codeChallengeBigInt, { value: sendValue1 });
            await tokenBridge
                .connect(user2)
                .lockTokens(codeChallengeBigInt, { value: sendValue2 });

            const totalLocked = await tokenBridge.lockedTokens(codeChallengeBigInt);
            expect(totalLocked).to.equal(expectedBU);
        });

        it('Should allow the same depositor to add more ETH to same Mina account', async function () {
            const { tokenBridge, user1 } = await deployTokenBridgeFixture();
            const sendValue1 = ethers.parseEther('0.5');
            const sendValue2 = ethers.parseEther('1.0');
            const expectedBU = (sendValue1 + sendValue2) / WEI_PER_BRIDGE_UNIT;

            await tokenBridge
                .connect(user1)
                .lockTokens(codeChallengeBigInt, { value: sendValue1 });
            await tokenBridge
                .connect(user1)
                .lockTokens(codeChallengeBigInt, { value: sendValue2 });

            const totalLocked = await tokenBridge.lockedTokens(
                codeChallengeBigInt
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
                    .lockTokens(codeChallengeBigInt, { value: hugeValue })
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
            await tokenBridge.connect(owner).setLockFeeRate(1000); // 1%
            await tokenBridge.connect(owner).setFeeRecipient(treasury.address);

            // Lock tokens to accumulate fees
            const sendValue = ethers.parseEther('10.0'); // 10_000_000 BU
            const feeBU = (sendValue / WEI_PER_BRIDGE_UNIT) * 1000n / 100000n; // 100000 BU
            const expectedFeeWei = feeBU * WEI_PER_BRIDGE_UNIT; // 0.1 ETH

            await tokenBridge.connect(user1).lockTokens(codeChallengeBigInt, { value: sendValue });

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

            await tokenBridge.connect(owner).setLockFeeRate(500); // 0.5%
            await tokenBridge.connect(owner).setFeeRecipient(treasury.address);

            const sendValue = ethers.parseEther('2.0'); // 2_000_000 BU
            const feeBU = (sendValue / WEI_PER_BRIDGE_UNIT) * 500n / 100000n; // 10000 BU
            const expectedFeeWei = feeBU * WEI_PER_BRIDGE_UNIT;

            await tokenBridge.connect(user1).lockTokens(codeChallengeBigInt, { value: sendValue });

            await expect(tokenBridge.connect(treasury).withdrawFees())
                .to.emit(tokenBridge, 'FeesWithdrawn')
                .withArgs(treasury.address, expectedFeeWei);
        });

        it('Should revert if caller is not feeRecipient', async function () {
            const { tokenBridge, owner, user1, treasury } = await deployTokenBridgeFixture();

            await tokenBridge.connect(owner).setLockFeeRate(1000);
            await tokenBridge.connect(owner).setFeeRecipient(treasury.address);
            await tokenBridge.connect(user1).lockTokens(codeChallengeBigInt, {
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
            const [grossAmount, fee, actualNetAmount] = await tokenBridge.calcGrossLockAmount(desiredNet);

            expect(grossAmount).to.equal(desiredNet);
            expect(fee).to.equal(0n);
            expect(actualNetAmount).to.equal(desiredNet);
        });

        it('Should compute correct gross amount for various fee rates', async function () {
            const { tokenBridge, owner } = await deployTokenBridgeFixture();

            // Test at 1000 rate units (1%)
            await tokenBridge.connect(owner).setLockFeeRate(1000);
            const desiredNet = ethers.parseEther('1.0');
            const [grossAmount, fee, actualNetAmount] = await tokenBridge.calcGrossLockAmount(desiredNet);

            // Verify using bridge unit math (same as contract)
            const grossBU = grossAmount / WEI_PER_BRIDGE_UNIT;
            const feeBU = grossBU * 1000n / 100000n;
            const netBU = grossBU - feeBU;
            const desiredNetBU = desiredNet / WEI_PER_BRIDGE_UNIT;

            expect(netBU).to.be.gte(desiredNetBU);
            expect(actualNetAmount).to.equal(netBU * WEI_PER_BRIDGE_UNIT);
            // fee is computed as feeBU * WEI_PER_BRIDGE_UNIT (always BU-aligned)
            expect(fee).to.equal(feeBU * WEI_PER_BRIDGE_UNIT);
        });

        it('Should produce a usable gross estimate for fee-aligned amounts', async function () {
            const { tokenBridge, owner, user1 } = await deployTokenBridgeFixture();

            // Use 1000 rate units (1%)
            // 0.99 ETH desired net = 990000 BU
            // grossBU = ceil(990000 * 100000 / 99000) = 1000000
            // grossAmount = 1 ETH exactly
            await tokenBridge.connect(owner).setLockFeeRate(1000);

            const desiredNet = ethers.parseEther('0.99');
            const desiredNetBU = desiredNet / WEI_PER_BRIDGE_UNIT;
            const [grossAmount, _fee, actualNetAmount] = await tokenBridge.calcGrossLockAmount(desiredNet);

            // Verify the gross works with lockTokens
            await tokenBridge
                .connect(user1)
                .lockTokens(codeChallengeBigInt, { value: grossAmount });

            // lockedTokens returns bridge units
            const locked = await tokenBridge.lockedTokens(codeChallengeBigInt);
            expect(locked).to.be.gte(desiredNetBU);
            expect(actualNetAmount).to.equal(locked * WEI_PER_BRIDGE_UNIT);
        });

        it('Should round up non-BU-aligned desiredNetAmount', async function () {
            const { tokenBridge } = await deployTokenBridgeFixture();

            // Pass a value that's not BU-aligned (e.g. 1 wei more than 1 ETH)
            const unaligned = ethers.parseEther('1.0') + 1n;
            const [grossAmount, fee, actualNetAmount] = await tokenBridge.calcGrossLockAmount(unaligned);

            // grossAmount should be rounded up to 2 BU more than 1 ETH (next BU boundary)
            // desiredNetBU = ceil((10^18 + 1) / 10^12) = 1000001
            // At 0% fee: grossAmount = 1000001 * 10^12
            expect(grossAmount).to.equal(1000001n * WEI_PER_BRIDGE_UNIT);
            expect(fee).to.equal(0n);
            expect(actualNetAmount).to.equal(grossAmount); // 0% fee: net == gross
            // grossAmount is BU-aligned and >= desiredNetAmount
            expect(grossAmount).to.be.gte(unaligned);
            expect(grossAmount % WEI_PER_BRIDGE_UNIT).to.equal(0n);
        });

        it('Should handle MIN_FEE_BU edge case for small amounts', async function () {
            const { tokenBridge, owner, user1 } = await deployTokenBridgeFixture();

            // Set 1 rate unit — at 1010 BU deposit, feeBU = 1010*1/100000 = 0 → rounds up to MIN_FEE_BU = 10
            await tokenBridge.connect(owner).setLockFeeRate(1);

            const desiredNet = 1000n * WEI_PER_BRIDGE_UNIT; // want 1000 BU net (= MIN_LOCK_AMOUNT_WEI)
            const [grossAmount, fee, actualNetAmount] = await tokenBridge.calcGrossLockAmount(desiredNet);

            // grossBU should be desiredNetBU + MIN_FEE_BU = 1000 + 10 = 1010
            expect(grossAmount).to.equal(1010n * WEI_PER_BRIDGE_UNIT);
            expect(fee).to.equal(10n * WEI_PER_BRIDGE_UNIT); // MIN_FEE_BU
            expect(actualNetAmount).to.equal(1000n * WEI_PER_BRIDGE_UNIT);

            // Verify it actually works with lockTokens
            await tokenBridge
                .connect(user1)
                .lockTokens(codeChallengeBigInt, { value: grossAmount });

            const locked = await tokenBridge.lockedTokens(codeChallengeBigInt);
            expect(locked).to.equal(1000n); // 1000 BU net
        });

        it('Should clamp gross to MIN_LOCK_AMOUNT when desired net is tiny', async function () {
            const { tokenBridge, owner, user1 } = await deployTokenBridgeFixture();

            // Set 500 rate units = 0.5% fee
            await tokenBridge.connect(owner).setLockFeeRate(500);

            // Request only 50 BU net — below MIN_LOCK_AMOUNT_WEI (100 BU gross)
            const desiredNet = 50n * WEI_PER_BRIDGE_UNIT;
            const [grossAmount, fee, actualNetAmount] = await tokenBridge.calcGrossLockAmount(desiredNet);

            // grossAmount should be clamped up to at least MIN_LOCK_AMOUNT_WEI
            expect(grossAmount).to.be.gte(100n * WEI_PER_BRIDGE_UNIT);
            expect(grossAmount % WEI_PER_BRIDGE_UNIT).to.equal(0n);

            // actualNetAmount should exceed desiredNet (boosted by minimum)
            expect(actualNetAmount).to.be.gte(desiredNet);

            // fee + actualNetAmount == grossAmount
            expect(fee + actualNetAmount).to.equal(grossAmount);

            // Verify it actually works with lockTokens
            await tokenBridge
                .connect(user1)
                .lockTokens(codeChallengeBigInt, { value: grossAmount });

            const locked = await tokenBridge.lockedTokens(codeChallengeBigInt);
            expect(locked * WEI_PER_BRIDGE_UNIT).to.equal(actualNetAmount);
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
            const tokenBridge = await TokenBridge.deploy(
                owner.address,
                dummyState.address,
                dummyAccount.address,
                await deployProofQueueAddress(),
                ZKAPP_ACCT_TOKEN_ID,
                ZKAPP_ACCT_VERIFICATION_KEY_HASH,
                ethers.ZeroAddress
            );

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
        // NOTE: Constructor now requires aligned contracts, so isConfigured() is always true after deploy.
        // The "false before set" and "revert when not configured" cases can no longer occur.
        it('Should return false before aligned contracts are set', async function () {
            // Constructor now sets aligned contracts — this test documents that isConfigured is always true after deploy
            const [owner, dummyState, dummyAccount] = await ethers.getSigners();
            const TokenBridge = new NoriTokenBridge__factory(owner);
            const tokenBridge = await TokenBridge.deploy(
                owner.address,
                dummyState.address,
                dummyAccount.address,
                await deployProofQueueAddress(),
                ZKAPP_ACCT_TOKEN_ID,
                ZKAPP_ACCT_VERIFICATION_KEY_HASH,
                ethers.ZeroAddress
            );

            expect(await tokenBridge.isConfigured()).to.equal(true);
        });

        it('Should return true after aligned contracts are set', async function () {
            const { tokenBridge } = await deployTokenBridgeFixture();
            expect(await tokenBridge.isConfigured()).to.equal(true);
        });
    });

    // -----------------------------------------------------------
    // Proof request enqueueing
    // -----------------------------------------------------------
    describe('Proof requests', function () {
        it('Should enqueue exactly one request per lock', async function () {
            const { tokenBridge, proofQueue, user1 } = await deployTokenBridgeFixture();

            expect(await proofQueue.head()).to.equal(0n);

            await tokenBridge
                .connect(user1)
                .lockTokens(codeChallengeBigInt, {
                    value: ethers.parseEther('1.0'),
                });
            expect(await proofQueue.head()).to.equal(1n);

            await tokenBridge
                .connect(user1)
                .lockTokens(codeChallengeBigInt, {
                    value: ethers.parseEther('1.0'),
                });
            expect(await proofQueue.head()).to.equal(2n);
        });

        it('Should record the bridge as target and the codeChallenge as the only collection key', async function () {
            const { tokenBridge, proofQueue, user1 } = await deployTokenBridgeFixture();

            await tokenBridge
                .connect(user1)
                .lockTokens(codeChallengeBigInt, {
                    value: ethers.parseEther('1.0'),
                });

            const request = await proofQueue.requests(0n);
            // The depositor is user1, but the request belongs to the bridge:
            // the queue stamps msg.sender, which namespaces the proven leaf.
            expect(request.target).to.equal(await tokenBridge.getAddress());
            expect(request.collectionKeysCount).to.equal(1);
            expect(request.collectionKeys[0]).to.equal(codeChallengeHex);
            expect(request.collectionKeys[1]).to.equal(ethers.ZeroHash);
        });

        it('Should enqueue the storage key that actually holds lockedTokens[codeChallenge]', async function () {
            const { tokenBridge, proofQueue, user1 } = await deployTokenBridgeFixture();

            const sendValue = ethers.parseEther('1.0');
            await tokenBridge
                .connect(user1)
                .lockTokens(codeChallengeBigInt, { value: sendValue });

            const request = await proofQueue.requests(0n);

            // Recompute the mapping location independently of the contract.
            const expectedSlotKey = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ['uint256', 'uint256'],
                    [codeChallengeBigInt, LOCKED_TOKENS_SLOT_INDEX]
                )
            );
            expect(request.slotKey).to.equal(expectedSlotKey);

            // ...and prove it really is the deposit's slot: the word stored
            // there must equal the cumulative balance the circuit will read.
            const storedValue = BigInt(
                await ethers.provider.getStorage(
                    await tokenBridge.getAddress(),
                    request.slotKey
                )
            );
            expect(storedValue).to.equal(
                await tokenBridge.lockedTokens(codeChallengeBigInt)
            );
            expect(storedValue).to.equal(sendValue / WEI_PER_BRIDGE_UNIT);
        });

        it('Should keep lockedTokens at slot 2 (circuit-visible layout)', async function () {
            const { tokenBridge, user1 } = await deployTokenBridgeFixture();

            await tokenBridge
                .connect(user1)
                .lockTokens(codeChallengeBigInt, {
                    value: ethers.parseEther('1.0'),
                });

            const slot = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ['uint256', 'uint256'],
                    [codeChallengeBigInt, 2n]
                )
            );
            const stored = BigInt(
                await ethers.provider.getStorage(
                    await tokenBridge.getAddress(),
                    slot
                )
            );
            expect(stored).to.equal(
                await tokenBridge.lockedTokens(codeChallengeBigInt)
            );
            expect(stored).to.be.gt(0n);
        });

        it('Should enqueue a separate request per deposit for the same codeChallenge', async function () {
            const { tokenBridge, proofQueue, user1, user2 } = await deployTokenBridgeFixture();

            await tokenBridge
                .connect(user1)
                .lockTokens(codeChallengeBigInt, {
                    value: ethers.parseEther('1.0'),
                });
            await tokenBridge
                .connect(user2)
                .lockTokens(codeChallengeBigInt, {
                    value: ethers.parseEther('2.0'),
                });

            expect(await proofQueue.head()).to.equal(2n);

            // Duplicates are harmless: both name the same slot, whose value is
            // the cumulative balance at proving time.
            const first = await proofQueue.requests(0n);
            const second = await proofQueue.requests(1n);
            expect(second.slotKey).to.equal(first.slotKey);
            expect(second.collectionKeys[0]).to.equal(first.collectionKeys[0]);
        });
    });

    // -----------------------------------------------------------
    // Lock fee with a non-zero proof request queue fee
    //
    // fee = proofRequestQueueFee (forwarded to the queue) + lockFeeRate applied to the
    // deposit (kept by the treasury).
    // -----------------------------------------------------------
    describe('Locking Tokens (with proof request queue fee)', function () {
        it('Should charge exactly the proof request queue fee when no rate is configured', async function () {
            const { tokenBridge, proofQueue, user1 } =
                await deployTokenBridgeFixture(PROOF_REQUEST_QUEUE_FEE);

            const sendValue = ethers.parseEther('1.0');
            const grossBU = sendValue / WEI_PER_BRIDGE_UNIT;
            const proofRequestQueueFeeBU = PROOF_REQUEST_QUEUE_FEE / WEI_PER_BRIDGE_UNIT;

            await tokenBridge
                .connect(user1)
                .lockTokens(codeChallengeBigInt, { value: sendValue });

            expect(await tokenBridge.lockedTokens(codeChallengeBigInt)).to.equal(
                grossBU - proofRequestQueueFeeBU
            );
            // Nothing left over for the treasury — the whole fee funded the proof.
            expect(await tokenBridge.accumulatedFees()).to.equal(0n);
            expect(
                await ethers.provider.getBalance(await proofQueue.getAddress())
            ).to.equal(PROOF_REQUEST_QUEUE_FEE);
            expect(await proofQueue.accumulatedFees()).to.equal(PROOF_REQUEST_QUEUE_FEE);
        });

        it('Should add the rate on top of the proof request queue fee and keep only the rate', async function () {
            const { tokenBridge, proofQueue, owner, user1 } =
                await deployTokenBridgeFixture(PROOF_REQUEST_QUEUE_FEE);

            await tokenBridge.connect(owner).setLockFeeRate(1000); // 1%

            const sendValue = ethers.parseEther('1.0');
            const grossBU = sendValue / WEI_PER_BRIDGE_UNIT;
            const rateFeeBU = (grossBU * 1000n) / 100000n;
            const proofRequestQueueFeeBU = PROOF_REQUEST_QUEUE_FEE / WEI_PER_BRIDGE_UNIT;

            await tokenBridge
                .connect(user1)
                .lockTokens(codeChallengeBigInt, { value: sendValue });

            expect(await tokenBridge.lockedTokens(codeChallengeBigInt)).to.equal(
                grossBU - rateFeeBU - proofRequestQueueFeeBU
            );
            // Treasury keeps the rate portion only.
            expect(await tokenBridge.accumulatedFees()).to.equal(
                rateFeeBU * WEI_PER_BRIDGE_UNIT
            );
            expect(
                await ethers.provider.getBalance(await proofQueue.getAddress())
            ).to.equal(PROOF_REQUEST_QUEUE_FEE);
        });

        it('Should report the combined fee in TokensLocked', async function () {
            const { tokenBridge, owner, user1 } =
                await deployTokenBridgeFixture(PROOF_REQUEST_QUEUE_FEE);

            await tokenBridge.connect(owner).setLockFeeRate(1000); // 1%

            const sendValue = ethers.parseEther('1.0');
            const grossBU = sendValue / WEI_PER_BRIDGE_UNIT;
            const rateFeeBU = (grossBU * 1000n) / 100000n;
            const proofRequestQueueFeeBU = PROOF_REQUEST_QUEUE_FEE / WEI_PER_BRIDGE_UNIT;
            const feeWei = (rateFeeBU + proofRequestQueueFeeBU) * WEI_PER_BRIDGE_UNIT;
            const netWei = (grossBU - rateFeeBU - proofRequestQueueFeeBU) * WEI_PER_BRIDGE_UNIT;

            await expect(
                tokenBridge
                    .connect(user1)
                    .lockTokens(codeChallengeBigInt, { value: sendValue })
            )
                .to.emit(tokenBridge, 'TokensLocked')
                .withArgs(user1.address, codeChallengeBigInt, netWei, feeWei);
        });

        it('Should leave the bridge holding exactly the locked funds plus treasury fees', async function () {
            const { tokenBridge, owner, user1 } =
                await deployTokenBridgeFixture(PROOF_REQUEST_QUEUE_FEE);

            await tokenBridge.connect(owner).setLockFeeRate(1000); // 1%

            const sendValue = ethers.parseEther('1.0');
            await tokenBridge
                .connect(user1)
                .lockTokens(codeChallengeBigInt, { value: sendValue });

            const lockedWei =
                (await tokenBridge.totalLockedBU()) * WEI_PER_BRIDGE_UNIT;
            const balance = await ethers.provider.getBalance(
                await tokenBridge.getAddress()
            );

            expect(balance).to.equal(
                lockedWei + (await tokenBridge.accumulatedFees())
            );
            expect(balance).to.equal(sendValue - PROOF_REQUEST_QUEUE_FEE);
        });

        it('Should track a proof request queue fee change on the next deposit', async function () {
            const { tokenBridge, proofQueue, owner, user1 } =
                await deployTokenBridgeFixture(PROOF_REQUEST_QUEUE_FEE);

            const newProofRequestQueueFee = PROOF_REQUEST_QUEUE_FEE * 2n;
            await proofQueue.connect(owner).setProofRequestQueueFee(newProofRequestQueueFee);

            const sendValue = ethers.parseEther('1.0');
            await tokenBridge
                .connect(user1)
                .lockTokens(codeChallengeBigInt, { value: sendValue });

            expect(await tokenBridge.lockedTokens(codeChallengeBigInt)).to.equal(
                (sendValue - newProofRequestQueueFee) / WEI_PER_BRIDGE_UNIT
            );
            expect(
                await ethers.provider.getBalance(await proofQueue.getAddress())
            ).to.equal(newProofRequestQueueFee);
        });
    });

    // -----------------------------------------------------------
    // Minimum deposit
    //
    // Two independent rules: the deposit clears MIN_LOCK_AMOUNT_WEI, and the
    // fee does not consume it entirely.
    // -----------------------------------------------------------
    describe('Minimum deposit', function () {
        it('Should not move the minimum when a queue fee is configured', async function () {
            const { tokenBridge } = await deployTokenBridgeFixture(PROOF_REQUEST_QUEUE_FEE);

            expect(await tokenBridge.MIN_LOCK_AMOUNT_WEI()).to.equal(
                1000n * WEI_PER_BRIDGE_UNIT
            );
        });

        it('Should reject a deposit below MIN_LOCK_AMOUNT_WEI', async function () {
            const { tokenBridge, user1 } = await deployTokenBridgeFixture(PROOF_REQUEST_QUEUE_FEE);

            const minimum = await tokenBridge.MIN_LOCK_AMOUNT_WEI();

            await expect(
                tokenBridge.connect(user1).lockTokens(codeChallengeBigInt, {
                    value: minimum - WEI_PER_BRIDGE_UNIT,
                })
            ).to.be.revertedWithCustomError(tokenBridge, 'BelowMinLockAmount');
        });

        it('Should accept the smallest deposit that covers the queue fee', async function () {
            const { tokenBridge, user1 } = await deployTokenBridgeFixture(PROOF_REQUEST_QUEUE_FEE);

            const minimum = await tokenBridge.MIN_LOCK_AMOUNT_WEI();
            await tokenBridge
                .connect(user1)
                .lockTokens(codeChallengeBigInt, { value: minimum });

            expect(await tokenBridge.lockedTokens(codeChallengeBigInt)).to.equal(
                (minimum - PROOF_REQUEST_QUEUE_FEE) / WEI_PER_BRIDGE_UNIT
            );
        });

        it('Should reject a deposit the queue fee would consume entirely', async function () {
            const { tokenBridge, proofQueue, owner, user1 } =
                await deployTokenBridgeFixture(PROOF_REQUEST_QUEUE_FEE);

            // MAX_PROOF_REQUEST_QUEUE_FEE sits well above MIN_LOCK_AMOUNT_WEI
            // to leave headroom for extreme gas conditions, so a fee set that
            // high makes minimum-sized deposits unpayable. Keeping the live
            // fee below the minimum deposit is an operational rule; this is
            // the backstop that makes breaking it a clean revert.
            const minimum = await tokenBridge.MIN_LOCK_AMOUNT_WEI();
            await proofQueue.connect(owner).setProofRequestQueueFee(minimum);

            await expect(
                tokenBridge
                    .connect(user1)
                    .lockTokens(codeChallengeBigInt, { value: minimum })
            ).to.be.revertedWithCustomError(tokenBridge, 'FeeExceedsLockAmount');
        });

        it('Should still lock at a queue fee just under the minimum deposit', async function () {
            const { tokenBridge, proofQueue, owner, user1 } =
                await deployTokenBridgeFixture(PROOF_REQUEST_QUEUE_FEE);

            const minimum = await tokenBridge.MIN_LOCK_AMOUNT_WEI();
            await proofQueue
                .connect(owner)
                .setProofRequestQueueFee(minimum - WEI_PER_BRIDGE_UNIT);

            await tokenBridge
                .connect(user1)
                .lockTokens(codeChallengeBigInt, { value: minimum });

            expect(await tokenBridge.lockedTokens(codeChallengeBigInt)).to.equal(1n);
        });
    });

    // -----------------------------------------------------------
    // calcGrossLockAmount with a proof request queue fee
    // -----------------------------------------------------------
    describe('calcGrossLockAmount (with proof request queue fee)', function () {
        it('Should quote a gross that lockTokens reproduces exactly at 0%', async function () {
            const { tokenBridge, user1 } = await deployTokenBridgeFixture(PROOF_REQUEST_QUEUE_FEE);

            const desiredNet = ethers.parseEther('1.0');
            const [grossAmount, fee, actualNetAmount] =
                await tokenBridge.calcGrossLockAmount(desiredNet);

            expect(fee).to.equal(PROOF_REQUEST_QUEUE_FEE);
            expect(grossAmount).to.equal(desiredNet + PROOF_REQUEST_QUEUE_FEE);
            expect(actualNetAmount).to.equal(desiredNet);

            await tokenBridge
                .connect(user1)
                .lockTokens(codeChallengeBigInt, { value: grossAmount });

            expect(await tokenBridge.lockedTokens(codeChallengeBigInt)).to.equal(
                actualNetAmount / WEI_PER_BRIDGE_UNIT
            );
        });

        it('Should quote a gross that lockTokens reproduces exactly with a rate', async function () {
            const { tokenBridge, owner, user1 } =
                await deployTokenBridgeFixture(PROOF_REQUEST_QUEUE_FEE);

            await tokenBridge.connect(owner).setLockFeeRate(1000); // 1%

            const desiredNet = ethers.parseEther('1.0');
            const [grossAmount, fee, actualNetAmount] =
                await tokenBridge.calcGrossLockAmount(desiredNet);

            expect(fee + actualNetAmount).to.equal(grossAmount);
            expect(actualNetAmount).to.be.gte(desiredNet);

            await tokenBridge
                .connect(user1)
                .lockTokens(codeChallengeBigInt, { value: grossAmount });

            expect(await tokenBridge.lockedTokens(codeChallengeBigInt)).to.equal(
                actualNetAmount / WEI_PER_BRIDGE_UNIT
            );
        });

        it('Should clamp the quote to the scaled minimum deposit', async function () {
            const { tokenBridge, user1 } = await deployTokenBridgeFixture(PROOF_REQUEST_QUEUE_FEE);

            const [grossAmount] = await tokenBridge.calcGrossLockAmount(
                WEI_PER_BRIDGE_UNIT
            );

            expect(grossAmount).to.be.gte(await tokenBridge.MIN_LOCK_AMOUNT_WEI());

            // The clamped quote is spendable.
            await tokenBridge
                .connect(user1)
                .lockTokens(codeChallengeBigInt, { value: grossAmount });
        });
    });

    // -----------------------------------------------------------
    // previewLock
    // -----------------------------------------------------------
    describe('previewLock', function () {
        it('Should quote exactly what lockTokens charges at 0%', async function () {
            const { tokenBridge, user1 } = await deployTokenBridgeFixture(PROOF_REQUEST_QUEUE_FEE);

            const gross = ethers.parseEther('1.0');
            const [fee, net] = await tokenBridge.previewLock(gross);

            await tokenBridge
                .connect(user1)
                .lockTokens(codeChallengeBigInt, { value: gross });

            expect(await tokenBridge.lockedTokens(codeChallengeBigInt)).to.equal(
                net / WEI_PER_BRIDGE_UNIT
            );
            expect(fee).to.equal(PROOF_REQUEST_QUEUE_FEE);
            expect(fee + net).to.equal(gross);
        });

        it('Should quote exactly what lockTokens charges with a rate', async function () {
            const { tokenBridge, owner, user1 } =
                await deployTokenBridgeFixture(PROOF_REQUEST_QUEUE_FEE);

            await tokenBridge.connect(owner).setLockFeeRate(1000); // 1%

            const gross = ethers.parseEther('1.0');
            const [fee, net] = await tokenBridge.previewLock(gross);

            await expect(
                tokenBridge
                    .connect(user1)
                    .lockTokens(codeChallengeBigInt, { value: gross })
            )
                .to.emit(tokenBridge, 'TokensLocked')
                .withArgs(user1.address, codeChallengeBigInt, net, fee);
        });

        it('Should round-trip with calcGrossLockAmount', async function () {
            const { tokenBridge, owner } =
                await deployTokenBridgeFixture(PROOF_REQUEST_QUEUE_FEE);

            await tokenBridge.connect(owner).setLockFeeRate(1000); // 1%

            const desiredNet = ethers.parseEther('1.0');
            const [grossAmount, quotedFee, quotedNet] =
                await tokenBridge.calcGrossLockAmount(desiredNet);

            const [fee, net] = await tokenBridge.previewLock(grossAmount);
            expect(fee).to.equal(quotedFee);
            expect(net).to.equal(quotedNet);
        });

        it('Should revert for a deposit below the minimum', async function () {
            const { tokenBridge } = await deployTokenBridgeFixture(PROOF_REQUEST_QUEUE_FEE);

            const minimum = await tokenBridge.MIN_LOCK_AMOUNT_WEI();

            await expect(
                tokenBridge.previewLock(minimum - WEI_PER_BRIDGE_UNIT)
            ).to.be.revertedWithCustomError(tokenBridge, 'BelowMinLockAmount');
        });

        it('Should revert for an amount that is not bridge-unit-aligned', async function () {
            const { tokenBridge } = await deployTokenBridgeFixture();

            await expect(
                tokenBridge.previewLock(ethers.parseEther('1.0') + 1n)
            ).to.be.revertedWithCustomError(
                tokenBridge,
                'InvalidBridgeUnitMultiple'
            );
        });
    });

    // -----------------------------------------------------------
    // Proof queue wiring
    // -----------------------------------------------------------
    describe('proofQueue', function () {
        it('Should expose the queue it was constructed with', async function () {
            const { tokenBridge, proofQueue } = await deployTokenBridgeFixture();

            expect(await tokenBridge.proofQueue()).to.equal(
                await proofQueue.getAddress()
            );
        });

        it('Should revert deployment if the proof queue is the zero address', async function () {
            const [deployer, , , dummyState, dummyAccount] = await ethers.getSigners();
            const TokenBridge = new NoriTokenBridge__factory(deployer);

            await expect(
                TokenBridge.deploy(
                    deployer.address,
                    dummyState.address,
                    dummyAccount.address,
                    ethers.ZeroAddress,
                    ZKAPP_ACCT_TOKEN_ID,
                    ZKAPP_ACCT_VERIFICATION_KEY_HASH,
                    ethers.ZeroAddress
                )
            ).to.be.revertedWithCustomError(TokenBridge, 'ZeroAddress');
        });

        it('Should have no setter for the proof queue', async function () {
            const { tokenBridge } = await deployTokenBridgeFixture();

            // Immutable by construction: the Mina bridge pins the same address
            // with no setter, so both sides move together or not at all.
            expect(
                tokenBridge.interface.fragments.some(
                    (fragment) =>
                        fragment.type === 'function' &&
                        'name' in fragment &&
                        /proofQueue/i.test(fragment.name as string) &&
                        fragment.name !== 'proofQueue'
                )
            ).to.equal(false);
        });
    });
});
