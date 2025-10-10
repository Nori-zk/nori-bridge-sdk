import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import { expect } from 'chai';
import { getRandomValues } from 'crypto';
import hre from 'hardhat';

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

describe('NoriTokenBridge', function () {
    async function deployTokenBridgeFixture() {
        const [owner, user1, user2] = await hre.ethers.getSigners();

        const TokenBridge = await hre.ethers.getContractFactory('NoriTokenBridge');
        const tokenBridge = await TokenBridge.deploy();

        return { tokenBridge, owner, user1, user2 };
    }

    describe('Deployment', function () {
        it('Should set the deployer as the bridge operator', async function () {
            const { tokenBridge, owner } = await loadFixture(
                deployTokenBridgeFixture
            );
            expect(await tokenBridge.bridgeOperator()).to.equal(owner.address);
        });
    });

    describe('Locking Tokens', function () {
        it('Should allow users to lock tokens and update mapping (BigInt)', async function () {
            const { tokenBridge, owner } = await loadFixture(
                deployTokenBridgeFixture
            );

            const sendValue = hre.ethers.parseEther('1.0');
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
            const { tokenBridge, owner } = await loadFixture(
                deployTokenBridgeFixture
            );

            const sendValue = hre.ethers.parseEther('1.0');
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
            const { tokenBridge, owner } = await loadFixture(
                deployTokenBridgeFixture
            );
            const sendValue = hre.ethers.parseEther('0.5');

            const tx = await tokenBridge
                .connect(owner)
                .lockTokens(attestationHashBigInt, { value: sendValue });
            const receipt = await tx.wait();

            if (!receipt) throw new Error('Transaction was not mined in time');

            const block = await hre.ethers.provider.getBlock(
                receipt.blockNumber
            );
            if (!block)
                throw new Error(`Block ${receipt.blockNumber} not found`);

            const blockTimestamp = block.timestamp;

            tokenBridge.once(
                tokenBridge.filters.TokensLocked(),
                (payload: any) => {
                    const [user, attestationHash, amount, when] =
                        payload.args as [string, bigint, bigint, bigint];

                    console.log(
                        '→ TokensLockedBigInt:\n\tuser=%s\n\tattestationHash=0x%s\n\tamount=%s\n\ttimestamp=%s',
                        user,
                        attestationHash,
                        amount.toString(),
                        when.toString()
                    );
                }
            );

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
            const { tokenBridge, owner } = await loadFixture(
                deployTokenBridgeFixture
            );
            const sendValue = hre.ethers.parseEther('0.5');

            const tx = await tokenBridge
                .connect(owner)
                .lockTokens(attestationHashHex, { value: sendValue });
            const receipt = await tx.wait();

            if (!receipt) throw new Error('Transaction was not mined in time');

            const block = await hre.ethers.provider.getBlock(
                receipt.blockNumber
            );
            if (!block)
                throw new Error(`Block ${receipt.blockNumber} not found`);

            const blockTimestamp = block.timestamp;

            tokenBridge.once(
                tokenBridge.filters.TokensLocked(),
                (payload: any) => {
                    const [user, attestationHash, amount, when] =
                        payload.args as [string, bigint, bigint, bigint];

                    console.log(
                        '→ TokensLockedHex:\n\tuser=%s\n\tattestationHash=0x%s\n\tamount=%s\n\ttimestamp=%s',
                        user,
                        attestationHash.toString(),
                        amount.toString(),
                        when.toString()
                    );
                }
            );

            await expect(tx)
                .to.emit(tokenBridge, 'TokensLocked')
                .withArgs(
                    owner.address,
                    attestationHashBigInt,
                    sendValue,
                    blockTimestamp
                );
        });

        it('Should revert if no Ether is sent (BigInt)', async function () {
            const { tokenBridge, owner } = await loadFixture(
                deployTokenBridgeFixture
            );

            await expect(
                tokenBridge
                    .connect(owner)
                    .lockTokens(attestationHashBigInt, { value: 0n })
            ).to.be.revertedWith('You must send some Ether to lock');
        });

        it('Should revert if no Ether is sent (hex string)', async function () {
            const { tokenBridge, owner } = await loadFixture(
                deployTokenBridgeFixture
            );

            await expect(
                tokenBridge
                    .connect(owner)
                    .lockTokens(attestationHashHex, { value: 0n })
            ).to.be.revertedWith('You must send some Ether to lock');
        });

        it('Should allow multiple locks from same address (BigInt)', async function () {
            const { tokenBridge, owner } = await loadFixture(
                deployTokenBridgeFixture
            );

            const value1 = hre.ethers.parseEther('0.2');
            const value2 = hre.ethers.parseEther('0.8');

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

        it('Should allow multiple locks from same address (hex string)', async function () {
            const { tokenBridge, owner } = await loadFixture(
                deployTokenBridgeFixture
            );

            const value1 = hre.ethers.parseEther('0.2');
            const value2 = hre.ethers.parseEther('0.8');

            await tokenBridge
                .connect(owner)
                .lockTokens(attestationHashHex, { value: value1 });
            await tokenBridge
                .connect(owner)
                .lockTokens(attestationHashHex, { value: value2 });

            const total = await tokenBridge.lockedTokens(
                owner.address,
                attestationHashHex
            );
            expect(total).to.equal(value1 + value2);
        });

        it('Manual slot calculation matches lockedTokens mapping', async function () {
            const { tokenBridge, owner } = await loadFixture(
                deployTokenBridgeFixture
            );

            const value = hre.ethers.parseEther('1.0');
            await tokenBridge.connect(owner).lockTokens(attestationHashBigInt, {
                value,
            });

            const outerSlot = 1; // lockedTokens mapping is at slot 1

            const paddedAddress = hre.ethers.zeroPadValue(owner.address, 32);
            const slotAsBytes = hre.ethers.toBeArray(
                hre.ethers.toQuantity(outerSlot)
            );
            const paddedSlot = hre.ethers.zeroPadValue(slotAsBytes, 32);
            const packedOuter = hre.ethers.concat([paddedAddress, paddedSlot]);
            const outerHash = hre.ethers.keccak256(packedOuter);

            const attestationBytes = hre.ethers.toBeArray(
                attestationHashBigInt
            );
            const paddedAttestation = hre.ethers.zeroPadValue(
                attestationBytes,
                32
            );
            const packedInner = hre.ethers.concat([
                paddedAttestation,
                outerHash,
            ]);
            const finalSlot = hre.ethers.keccak256(packedInner);

            const raw = await hre.network.provider.send('eth_getStorageAt', [
                tokenBridge.target,
                finalSlot,
                'latest',
            ]);
            const decoded = hre.ethers.toBigInt(raw);

            const valueFromMapping = await tokenBridge.lockedTokens(
                owner.address,
                attestationHashBigInt
            );

            console.log('decoded', decoded);

            expect(decoded).to.equal(valueFromMapping);
            expect(decoded).to.equal(value);
        });
    });

    describe('v2Rpc Tests', function () {
        it('Should convert wei to bridge units and update totalLocked correctly', async function () {
            const { tokenBridge, user1 } = await loadFixture(
                deployTokenBridgeFixture
            );
            const weiPerBridgeUnit = await tokenBridge.WEI_PER_BRIDGE_UNIT();

            const sendValue = hre.ethers.parseEther('1.0');
            const expectedBridgeUnits = sendValue / weiPerBridgeUnit;

            await tokenBridge
                .connect(user1)
                .lockTokens(attestationHashBigInt, { value: sendValue });

            const totalLocked = await tokenBridge.totalLocked();
            expect(totalLocked).to.equal(expectedBridgeUnits);
        });

        it('Should revert if value is not a multiple of bridge unit', async function () {
            const { tokenBridge, user1 } = await loadFixture(
                deployTokenBridgeFixture
            );
            const weiPerBridgeUnit = await tokenBridge.WEI_PER_BRIDGE_UNIT();

            const invalidAmount = weiPerBridgeUnit + 1n;
            await expect(
                tokenBridge
                    .connect(user1)
                    .lockTokens(attestationHashBigInt, { value: invalidAmount })
            ).to.be.revertedWith('Must be multiple of smallest bridge unit');
        });

        it('Should bind Mina account to first depositor and reject others', async function () {
            const { tokenBridge, user1, user2 } = await loadFixture(
                deployTokenBridgeFixture
            );
            const sendValue = hre.ethers.parseEther('1.0');

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
            ).to.be.revertedWith(
                'This Mina account is already linked to a different ETH address'
            );
        });

        it('Should allow the same depositor to add more ETH to same Mina account', async function () {
            const { tokenBridge, user1 } = await loadFixture(
                deployTokenBridgeFixture
            );
            const sendValue1 = hre.ethers.parseEther('0.5');
            const sendValue2 = hre.ethers.parseEther('1.0');

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

        it.skip('Should revert if total locked exceeds MAX_MAGNITUDE', async function () {
            const { tokenBridge, user1 } = await loadFixture(
                deployTokenBridgeFixture
            );

            const weiPerBridgeUnit = await tokenBridge.WEI_PER_BRIDGE_UNIT();
            const maxMagnitude = await tokenBridge.MAX_MAGNITUDE();

            const hugeValue = (maxMagnitude + 1n) * weiPerBridgeUnit;
            await expect(
                tokenBridge
                    .connect(user1)
                    .lockTokens(attestationHashBigInt, { value: hugeValue })
            ).to.be.revertedWith('Total locked exceeds maximum allowed');
        });

        it('Should allow only bridge operator to withdraw', async function () {
            const { tokenBridge, owner, user1 } = await loadFixture(
                deployTokenBridgeFixture
            );

            const sendValue = hre.ethers.parseEther('0.5');
            await tokenBridge
                .connect(user1)
                .lockTokens(attestationHashBigInt, { value: sendValue });

            await expect(
                tokenBridge.connect(user1).withdraw()
            ).to.be.revertedWith('Only bridge operator can withdraw');

            await expect(
                tokenBridge.connect(owner).withdraw()
            ).to.changeEtherBalance(owner, sendValue);
        });

        it('Should revert withdraw if no ETH in contract', async function () {
            const { tokenBridge, owner } = await loadFixture(
                deployTokenBridgeFixture
            );
            await expect(
                tokenBridge.connect(owner).withdraw()
            ).to.be.revertedWith('No ETH to withdraw');
        });
    });
});
