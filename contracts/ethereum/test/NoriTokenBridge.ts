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
        const [owner, user1, user2, dummyState, dummyAccount] = await ethers.getSigners();

        const TokenBridge = new NoriTokenBridge__factory(owner);

        // Constructor now requires explicit bridgeOperator address
        const tokenBridge = await TokenBridge.deploy(owner.address);

        // Configure with dummy aligned contract addresses so onlyConfigured passes
        await tokenBridge.setAlignedContracts(dummyState.address, dummyAccount.address);

        return { tokenBridge, owner, user1, user2, dummyState, dummyAccount };
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

            // old operator can no longer call admin functions
            await expect(
                tokenBridge.connect(owner).setBridgeOperator(owner.address)
            ).to.be.revertedWithCustomError(tokenBridge, 'NotBridgeOperator');

            // new operator can
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
    // Locking Tokens
    // -----------------------------------------------------------
    describe('Locking Tokens', function () {
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

        it('Should emit TokensLocked event with correct parameters (BigInt)', async function () {
            const { tokenBridge, owner } = await deployTokenBridgeFixture();
            const sendValue = ethers.parseEther('0.5');

            const tx = await tokenBridge
                .connect(owner)
                .lockTokens(attestationHashBigInt, { value: sendValue });
            const receipt = await tx.wait();

            if (!receipt) throw new Error('Transaction was not mined in time');

            const block = await ethers.provider.getBlock(
                receipt.blockNumber
            );
            if (!block)
                throw new Error(`Block ${receipt.blockNumber} not found`);

            const blockTimestamp = block.timestamp;

            await expect(tx)
                .to.emit(tokenBridge, 'TokensLocked')
                .withArgs(
                    owner.address,
                    attestationHashHex,
                    sendValue,
                    blockTimestamp
                );
        });

        it('Should emit TokensLocked event with correct parameters (hex string)', async function () {
            const { tokenBridge, owner } = await deployTokenBridgeFixture();
            const sendValue = ethers.parseEther('0.5');

            const tx = await tokenBridge
                .connect(owner)
                .lockTokens(attestationHashHex, { value: sendValue });
            const receipt = await tx.wait();

            if (!receipt) throw new Error('Transaction was not mined in time');

            const block = await ethers.provider.getBlock(
                receipt.blockNumber
            );
            if (!block)
                throw new Error(`Block ${receipt.blockNumber} not found`);

            const blockTimestamp = block.timestamp;

            await expect(tx)
                .to.emit(tokenBridge, 'TokensLocked')
                .withArgs(
                    owner.address,
                    attestationHashBigInt,
                    sendValue,
                    blockTimestamp
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
    // Withdraw (admin-only, .call-based ETH send)
    // -----------------------------------------------------------
    describe('Withdraw', function () {
        it('Should allow only bridge operator to withdraw', async function () {
            const { tokenBridge, owner, user1 } = await deployTokenBridgeFixture();

            const sendValue = ethers.parseEther('0.5');
            await tokenBridge
                .connect(user1)
                .lockTokens(attestationHashBigInt, { value: sendValue });

            await expect(
                tokenBridge.connect(user1).withdraw()
            ).to.be.revertedWithCustomError(tokenBridge, 'NotBridgeOperator');

            const ownerBalBefore = await ethers.provider.getBalance(owner.address);
            const tx = await tokenBridge.connect(owner).withdraw();
            const receipt = await tx.wait();
            if (!receipt) throw new Error('Withdraw tx not mined');
            const gasUsed = receipt.gasUsed * receipt.gasPrice;
            const ownerBalAfter = await ethers.provider.getBalance(owner.address);
            expect(ownerBalAfter - ownerBalBefore + gasUsed).to.equal(sendValue);
        });

        it('Should revert withdraw if no ETH in contract', async function () {
            const { tokenBridge, owner } = await deployTokenBridgeFixture();
            await expect(
                tokenBridge.connect(owner).withdraw()
            ).to.be.revertedWithCustomError(tokenBridge, 'NoEthToWithdraw');
        });

        it('Should transfer full contract balance to operator via .call', async function () {
            const { tokenBridge, owner, user1 } = await deployTokenBridgeFixture();

            const sendValue = ethers.parseEther('2.0');
            await tokenBridge
                .connect(user1)
                .lockTokens(attestationHashBigInt, { value: sendValue });

            const balanceBefore = await ethers.provider.getBalance(tokenBridge.target);
            expect(balanceBefore).to.equal(sendValue);

            await tokenBridge.connect(owner).withdraw();

            const balanceAfter = await ethers.provider.getBalance(tokenBridge.target);
            expect(balanceAfter).to.equal(0n);
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
