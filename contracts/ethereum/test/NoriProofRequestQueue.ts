/// <reference types="@nomicfoundation/hardhat-ethers" />
/// <reference types="@nomicfoundation/hardhat-ethers-chai-matchers" />
import { expect } from 'chai';
import { NoriProofRequestQueue__factory } from 'types/ethers-contracts/index.js';
import hre from 'hardhat';
import entryLocationVectors from './test-vectors/proof-request-queue/entry-location-vectors.json' with { type: 'json' };
const { ethers } = await hre.network.getOrCreate();

const PROOF_REQUEST_QUEUE_FEE_GRANULARITY_WEI = 10n ** 12n;
const MAX_PROOF_REQUEST_QUEUE_FEE = ethers.parseEther('0.05');
const PROOF_REQUEST_QUEUE_FEE = 200n * PROOF_REQUEST_QUEUE_FEE_GRANULARITY_WEI; // 0.0002 ETH

// Consensus-critical storage layout mirrored by the SP1 guest program.
// These indices are duplicated in nori-primitives; a change here is a change
// to the circuit and invalidates every previously generated proof.
const HEAD_SLOT_INDEX = 0n;
const REQUESTS_SLOT_INDEX = 1n;
const PROOF_REQUEST_QUEUE_FEE_SLOT_INDEX = 2n;
const OPERATOR_SLOT_INDEX = 3n;
const FEE_RECIPIENT_SLOT_INDEX = 4n;
const ACCUMULATED_FEES_SLOT_INDEX = 5n;

const SLOT_KEY_A =
    '0x00000000000000000000000000000000000000000000000000000000000000aa';
const COLLECTION_KEY_A =
    '0x1111111111111111111111111111111111111111111111111111111111111111';
const COLLECTION_KEY_B =
    '0x2222222222222222222222222222222222222222222222222222222222222222';

/** Location of `_requests[requestId]`'s first word, per Solidity's mapping rule. */
function entryBaseSlot(requestId: bigint): bigint {
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256', 'uint256'],
        [requestId, REQUESTS_SLOT_INDEX]
    );
    return BigInt(ethers.keccak256(encoded));
}

/** Struct members occupy consecutive slots: word `n` lives at `base + n`. */
function slotHex(slot: bigint): string {
    return `0x${slot.toString(16).padStart(64, '0')}`;
}

/** Read one raw storage word as a bigint. */
async function readStorage(address: string, slot: bigint): Promise<bigint> {
    return BigInt(await ethers.provider.getStorage(address, slotHex(slot)));
}

describe('NoriProofRequestQueue', () => {
    async function deployQueueFixture() {
        const [operator, consumer, other, treasury] = await ethers.getSigners();

        const Queue = new NoriProofRequestQueue__factory(operator);
        const queue = await Queue.deploy(
            operator.address,
            treasury.address,
            PROOF_REQUEST_QUEUE_FEE
        );

        return { queue, operator, consumer, other, treasury };
    }

    // -----------------------------------------------------------
    // Deployment & Constructor
    // -----------------------------------------------------------
    describe('Deployment', function () {
        it('Should set operator, feeRecipient and proofRequestQueueFee from constructor', async function () {
            const { queue, operator, treasury } = await deployQueueFixture();

            expect(await queue.operator()).to.equal(operator.address);
            expect(await queue.feeRecipient()).to.equal(treasury.address);
            expect(await queue.proofRequestQueueFee()).to.equal(PROOF_REQUEST_QUEUE_FEE);
        });

        it('Should start with an empty queue', async function () {
            const { queue } = await deployQueueFixture();

            expect(await queue.head()).to.equal(0n);
            expect(await queue.accumulatedFees()).to.equal(0n);
        });

        it('Should emit OperatorSet, FeeRecipientSet and ProofRequestQueueFeeSet at deployment', async function () {
            const [operator, , , treasury] = await ethers.getSigners();
            const Queue = new NoriProofRequestQueue__factory(operator);
            const queue = await Queue.deploy(
                operator.address,
                treasury.address,
                PROOF_REQUEST_QUEUE_FEE
            );

            const deployTx = queue.deploymentTransaction();
            if (!deployTx) throw new Error('No deployment tx');

            await expect(deployTx)
                .to.emit(queue, 'OperatorSet')
                .withArgs(ethers.ZeroAddress, operator.address)
                .and.to.emit(queue, 'FeeRecipientSet')
                .withArgs(ethers.ZeroAddress, treasury.address)
                .and.to.emit(queue, 'ProofRequestQueueFeeSet')
                .withArgs(0n, PROOF_REQUEST_QUEUE_FEE);
        });

        it('Should allow deferring the fee recipient with the zero address', async function () {
            const [operator] = await ethers.getSigners();
            const Queue = new NoriProofRequestQueue__factory(operator);
            const queue = await Queue.deploy(
                operator.address,
                ethers.ZeroAddress,
                PROOF_REQUEST_QUEUE_FEE
            );

            expect(await queue.feeRecipient()).to.equal(ethers.ZeroAddress);
        });

        it('Should revert if operator is the zero address', async function () {
            const [deployer, , , treasury] = await ethers.getSigners();
            const Queue = new NoriProofRequestQueue__factory(deployer);

            await expect(
                Queue.deploy(ethers.ZeroAddress, treasury.address, PROOF_REQUEST_QUEUE_FEE)
            ).to.be.revertedWithCustomError(Queue, 'ZeroAddress');
        });

        it('Should revert if the initial fee exceeds MAX_PROOF_REQUEST_QUEUE_FEE', async function () {
            const [operator, , , treasury] = await ethers.getSigners();
            const Queue = new NoriProofRequestQueue__factory(operator);

            await expect(
                Queue.deploy(
                    operator.address,
                    treasury.address,
                    MAX_PROOF_REQUEST_QUEUE_FEE + PROOF_REQUEST_QUEUE_FEE_GRANULARITY_WEI
                )
            ).to.be.revertedWithCustomError(Queue, 'ProofRequestQueueFeeTooHigh');
        });

        it('Should revert if the initial fee is not granularity-aligned', async function () {
            const [operator, , , treasury] = await ethers.getSigners();
            const Queue = new NoriProofRequestQueue__factory(operator);

            await expect(
                Queue.deploy(
                    operator.address,
                    treasury.address,
                    PROOF_REQUEST_QUEUE_FEE + 1n
                )
            ).to.be.revertedWithCustomError(Queue, 'ProofRequestQueueFeeNotAligned');
        });

        it('Should expose the consensus-critical constants', async function () {
            const { queue } = await deployQueueFixture();

            expect(await queue.MAX_COLLECTION_KEYS()).to.equal(2);
            expect(await queue.PROOF_REQUEST_QUEUE_FEE_GRANULARITY_WEI()).to.equal(
                PROOF_REQUEST_QUEUE_FEE_GRANULARITY_WEI
            );
            expect(await queue.MAX_PROOF_REQUEST_QUEUE_FEE()).to.equal(MAX_PROOF_REQUEST_QUEUE_FEE);
        });
    });

    // -----------------------------------------------------------
    // Storage layout
    //
    // The SP1 guest derives these locations itself and MPT-proves the words
    // it finds there. If any assertion in this block fails, the circuit
    // constants in nori-primitives must change in lockstep — and every
    // previously generated proof is invalidated.
    // -----------------------------------------------------------
    describe('Storage layout (consensus-critical)', function () {
        it('Should keep head at slot 0', async function () {
            const { queue, consumer } = await deployQueueFixture();
            const queueAddress = await queue.getAddress();

            expect(await readStorage(queueAddress, HEAD_SLOT_INDEX)).to.equal(0n);

            await queue
                .connect(consumer)
                .requestProof(SLOT_KEY_A, [COLLECTION_KEY_A], {
                    value: PROOF_REQUEST_QUEUE_FEE,
                });

            expect(await readStorage(queueAddress, HEAD_SLOT_INDEX)).to.equal(1n);
        });

        it('Should lay out each request as five consecutive words from the mapping at slot 1', async function () {
            const { queue, consumer } = await deployQueueFixture();
            const queueAddress = await queue.getAddress();

            await queue
                .connect(consumer)
                .requestProof(SLOT_KEY_A, [COLLECTION_KEY_A, COLLECTION_KEY_B], {
                    value: PROOF_REQUEST_QUEUE_FEE,
                });

            const base = entryBaseSlot(0n);

            // +0 target — an address is stored right-aligned, so the word
            // reads as the address's numeric value.
            expect(await readStorage(queueAddress, base)).to.equal(
                BigInt(consumer.address)
            );
            // +1 slotKey
            expect(await readStorage(queueAddress, base + 1n)).to.equal(
                BigInt(SLOT_KEY_A)
            );
            // +2 collectionKeysCount — its own word, deliberately unpacked
            expect(await readStorage(queueAddress, base + 2n)).to.equal(2n);
            // +3, +4 collectionKeys — a fixed array always starts a new slot,
            // so the count above never shares a word with the first key.
            expect(await readStorage(queueAddress, base + 3n)).to.equal(
                BigInt(COLLECTION_KEY_A)
            );
            expect(await readStorage(queueAddress, base + 4n)).to.equal(
                BigInt(COLLECTION_KEY_B)
            );
        });

        it('Should leave unused collection key words unwritten (read as zero)', async function () {
            const { queue, consumer } = await deployQueueFixture();
            const queueAddress = await queue.getAddress();

            await queue
                .connect(consumer)
                .requestProof(SLOT_KEY_A, [COLLECTION_KEY_A], {
                    value: PROOF_REQUEST_QUEUE_FEE,
                });

            const base = entryBaseSlot(0n);

            expect(await readStorage(queueAddress, base + 2n)).to.equal(1n);
            expect(await readStorage(queueAddress, base + 3n)).to.equal(
                BigInt(COLLECTION_KEY_A)
            );
            // Never written, so absent from the storage trie: the circuit
            // reads this via an exclusion proof as zero.
            expect(await readStorage(queueAddress, base + 4n)).to.equal(0n);
        });

        it('Should place consecutive requests at independent, index-derived locations', async function () {
            const { queue, consumer, other } = await deployQueueFixture();
            const queueAddress = await queue.getAddress();

            await queue
                .connect(consumer)
                .requestProof(SLOT_KEY_A, [COLLECTION_KEY_A], {
                    value: PROOF_REQUEST_QUEUE_FEE,
                });
            await queue
                .connect(other)
                .requestProof(SLOT_KEY_A, [COLLECTION_KEY_B], {
                    value: PROOF_REQUEST_QUEUE_FEE,
                });

            expect(await readStorage(queueAddress, entryBaseSlot(0n))).to.equal(
                BigInt(consumer.address)
            );
            expect(await readStorage(queueAddress, entryBaseSlot(1n))).to.equal(
                BigInt(other.address)
            );
        });

        it('Should keep configuration in slots 2 to 5, below the provable region', async function () {
            const { queue, operator, consumer, treasury } =
                await deployQueueFixture();
            const queueAddress = await queue.getAddress();

            await queue
                .connect(consumer)
                .requestProof(SLOT_KEY_A, [COLLECTION_KEY_A], {
                    value: PROOF_REQUEST_QUEUE_FEE,
                });

            expect(await readStorage(queueAddress, PROOF_REQUEST_QUEUE_FEE_SLOT_INDEX)).to.equal(
                PROOF_REQUEST_QUEUE_FEE
            );
            expect(await readStorage(queueAddress, OPERATOR_SLOT_INDEX)).to.equal(
                BigInt(operator.address)
            );
            expect(
                await readStorage(queueAddress, FEE_RECIPIENT_SLOT_INDEX)
            ).to.equal(BigInt(treasury.address));
            expect(
                await readStorage(queueAddress, ACCUMULATED_FEES_SLOT_INDEX)
            ).to.equal(PROOF_REQUEST_QUEUE_FEE);
        });

        // Cross-language pin: the slots asserted above are computed here in
        // TypeScript, and independently by the guest in Rust. These vectors are
        // generated by nori-bridge-head and vendored in, so a divergence in
        // either derivation fails here rather than at proving time.
        it('Should derive entry locations matching the Rust test vectors', async function () {
            expect(BigInt(entryLocationVectors.requestsMappingSlotIndex)).to.equal(
                REQUESTS_SLOT_INDEX
            );
            expect(BigInt(entryLocationVectors.headSlot)).to.equal(HEAD_SLOT_INDEX);

            for (const entry of entryLocationVectors.entries) {
                const base = entryBaseSlot(BigInt(entry.index));
                expect(base, `base for index ${entry.index}`).to.equal(
                    BigInt(entry.base)
                );

                expect(entry.words.length).to.equal(
                    entryLocationVectors.entryWords
                );
                for (const word of entry.words) {
                    expect(
                        base + BigInt(word.wordIndex),
                        `${word.name} for index ${entry.index}`
                    ).to.equal(BigInt(word.slot));
                }
            }
        });
    });

    // -----------------------------------------------------------
    // requestProof
    // -----------------------------------------------------------
    describe('requestProof', function () {
        it('Should record the caller as target', async function () {
            const { queue, consumer } = await deployQueueFixture();

            await queue
                .connect(consumer)
                .requestProof(SLOT_KEY_A, [COLLECTION_KEY_A], {
                    value: PROOF_REQUEST_QUEUE_FEE,
                });

            const request = await queue.requests(0n);
            expect(request.target).to.equal(consumer.address);
            expect(request.slotKey).to.equal(SLOT_KEY_A);
            expect(request.collectionKeysCount).to.equal(1);
            expect(request.collectionKeys[0]).to.equal(COLLECTION_KEY_A);
            expect(request.collectionKeys[1]).to.equal(ethers.ZeroHash);
        });

        it('Should return the assigned request id and advance head', async function () {
            const { queue, consumer } = await deployQueueFixture();

            expect(
                await queue
                    .connect(consumer)
                    .requestProof.staticCall(SLOT_KEY_A, [COLLECTION_KEY_A], {
                        value: PROOF_REQUEST_QUEUE_FEE,
                    })
            ).to.equal(0n);

            await queue
                .connect(consumer)
                .requestProof(SLOT_KEY_A, [COLLECTION_KEY_A], {
                    value: PROOF_REQUEST_QUEUE_FEE,
                });

            expect(await queue.head()).to.equal(1n);
        });

        it('Should emit ProofRequested', async function () {
            const { queue, consumer } = await deployQueueFixture();

            await expect(
                queue
                    .connect(consumer)
                    .requestProof(SLOT_KEY_A, [COLLECTION_KEY_A, COLLECTION_KEY_B], {
                        value: PROOF_REQUEST_QUEUE_FEE,
                    })
            )
                .to.emit(queue, 'ProofRequested')
                .withArgs(0n, consumer.address, SLOT_KEY_A, [
                    COLLECTION_KEY_A,
                    COLLECTION_KEY_B,
                ]);
        });

        it('Should accept a request with no collection keys', async function () {
            const { queue, consumer } = await deployQueueFixture();

            await queue.connect(consumer).requestProof(SLOT_KEY_A, [], {
                value: PROOF_REQUEST_QUEUE_FEE,
            });

            const request = await queue.requests(0n);
            expect(request.collectionKeysCount).to.equal(0);
            expect(request.collectionKeys[0]).to.equal(ethers.ZeroHash);
            expect(request.collectionKeys[1]).to.equal(ethers.ZeroHash);
        });

        it('Should accept a request at exactly MAX_COLLECTION_KEYS', async function () {
            const { queue, consumer } = await deployQueueFixture();

            await queue
                .connect(consumer)
                .requestProof(SLOT_KEY_A, [COLLECTION_KEY_A, COLLECTION_KEY_B], {
                    value: PROOF_REQUEST_QUEUE_FEE,
                });

            const request = await queue.requests(0n);
            expect(request.collectionKeysCount).to.equal(2);
        });

        it('Should revert if more than MAX_COLLECTION_KEYS are supplied', async function () {
            const { queue, consumer } = await deployQueueFixture();

            await expect(
                queue
                    .connect(consumer)
                    .requestProof(
                        SLOT_KEY_A,
                        [COLLECTION_KEY_A, COLLECTION_KEY_B, ethers.ZeroHash],
                        { value: PROOF_REQUEST_QUEUE_FEE }
                    )
            ).to.be.revertedWithCustomError(queue, 'TooManyCollectionKeys');
        });

        it('Should revert if msg.value is below proofRequestQueueFee', async function () {
            const { queue, consumer } = await deployQueueFixture();

            await expect(
                queue
                    .connect(consumer)
                    .requestProof(SLOT_KEY_A, [COLLECTION_KEY_A], {
                        value: PROOF_REQUEST_QUEUE_FEE - 1n,
                    })
            ).to.be.revertedWithCustomError(queue, 'InsufficientFee');
        });

        it('Should retain overpayment as protocol fees', async function () {
            const { queue, consumer } = await deployQueueFixture();
            const overpayment = PROOF_REQUEST_QUEUE_FEE * 2n;

            await queue
                .connect(consumer)
                .requestProof(SLOT_KEY_A, [COLLECTION_KEY_A], {
                    value: overpayment,
                });

            expect(await queue.accumulatedFees()).to.equal(overpayment);
        });

        it('Should be free to call when proofRequestQueueFee is zero', async function () {
            const [operator, consumer, , treasury] = await ethers.getSigners();
            const Queue = new NoriProofRequestQueue__factory(operator);
            const queue = await Queue.deploy(
                operator.address,
                treasury.address,
                0n
            );

            await queue
                .connect(consumer)
                .requestProof(SLOT_KEY_A, [COLLECTION_KEY_A]);

            expect(await queue.head()).to.equal(1n);
            expect(await queue.accumulatedFees()).to.equal(0n);
        });

        it('Should never overwrite an existing entry (append-only)', async function () {
            const { queue, consumer, other } = await deployQueueFixture();

            await queue
                .connect(consumer)
                .requestProof(SLOT_KEY_A, [COLLECTION_KEY_A], {
                    value: PROOF_REQUEST_QUEUE_FEE,
                });
            await queue
                .connect(other)
                .requestProof(ethers.ZeroHash, [COLLECTION_KEY_B, COLLECTION_KEY_A], {
                    value: PROOF_REQUEST_QUEUE_FEE,
                });

            expect(await queue.head()).to.equal(2n);

            const first = await queue.requests(0n);
            expect(first.target).to.equal(consumer.address);
            expect(first.slotKey).to.equal(SLOT_KEY_A);
            expect(first.collectionKeysCount).to.equal(1);
            expect(first.collectionKeys[0]).to.equal(COLLECTION_KEY_A);
            expect(first.collectionKeys[1]).to.equal(ethers.ZeroHash);

            const second = await queue.requests(1n);
            expect(second.target).to.equal(other.address);
            expect(second.slotKey).to.equal(ethers.ZeroHash);
            expect(second.collectionKeysCount).to.equal(2);
        });

        it('Should accumulate fees across requests', async function () {
            const { queue, consumer } = await deployQueueFixture();

            await queue
                .connect(consumer)
                .requestProof(SLOT_KEY_A, [COLLECTION_KEY_A], {
                    value: PROOF_REQUEST_QUEUE_FEE,
                });
            await queue
                .connect(consumer)
                .requestProof(SLOT_KEY_A, [COLLECTION_KEY_A], {
                    value: PROOF_REQUEST_QUEUE_FEE,
                });

            expect(await queue.accumulatedFees()).to.equal(PROOF_REQUEST_QUEUE_FEE * 2n);
        });

        it('Should read unqueued ids as an all-zero record', async function () {
            const { queue } = await deployQueueFixture();

            const request = await queue.requests(99n);
            expect(request.target).to.equal(ethers.ZeroAddress);
            expect(request.slotKey).to.equal(ethers.ZeroHash);
            expect(request.collectionKeysCount).to.equal(0);
        });
    });

    // -----------------------------------------------------------
    // setProofRequestQueueFee
    // -----------------------------------------------------------
    describe('setProofRequestQueueFee', function () {
        it('Should allow the operator to set the fee and emit the event', async function () {
            const { queue, operator } = await deployQueueFixture();
            const newFee = PROOF_REQUEST_QUEUE_FEE * 2n;

            await expect(queue.connect(operator).setProofRequestQueueFee(newFee))
                .to.emit(queue, 'ProofRequestQueueFeeSet')
                .withArgs(PROOF_REQUEST_QUEUE_FEE, newFee);

            expect(await queue.proofRequestQueueFee()).to.equal(newFee);
        });

        it('Should allow setting the fee to exactly MAX_PROOF_REQUEST_QUEUE_FEE', async function () {
            const { queue, operator } = await deployQueueFixture();

            await queue.connect(operator).setProofRequestQueueFee(MAX_PROOF_REQUEST_QUEUE_FEE);
            expect(await queue.proofRequestQueueFee()).to.equal(MAX_PROOF_REQUEST_QUEUE_FEE);
        });

        it('Should allow setting the fee back to zero', async function () {
            const { queue, operator } = await deployQueueFixture();

            await queue.connect(operator).setProofRequestQueueFee(0n);
            expect(await queue.proofRequestQueueFee()).to.equal(0n);
        });

        it('Should revert if the fee exceeds MAX_PROOF_REQUEST_QUEUE_FEE', async function () {
            const { queue, operator } = await deployQueueFixture();

            await expect(
                queue
                    .connect(operator)
                    .setProofRequestQueueFee(MAX_PROOF_REQUEST_QUEUE_FEE + PROOF_REQUEST_QUEUE_FEE_GRANULARITY_WEI)
            ).to.be.revertedWithCustomError(queue, 'ProofRequestQueueFeeTooHigh');
        });

        it('Should revert if the fee is not granularity-aligned', async function () {
            const { queue, operator } = await deployQueueFixture();

            await expect(
                queue.connect(operator).setProofRequestQueueFee(PROOF_REQUEST_QUEUE_FEE + 1n)
            ).to.be.revertedWithCustomError(queue, 'ProofRequestQueueFeeNotAligned');
        });

        it('Should revert if a non-operator sets the fee', async function () {
            const { queue, consumer } = await deployQueueFixture();

            await expect(
                queue.connect(consumer).setProofRequestQueueFee(PROOF_REQUEST_QUEUE_FEE)
            ).to.be.revertedWithCustomError(queue, 'NotOperator');
        });

        it('Should apply the new fee to subsequent requests', async function () {
            const { queue, operator, consumer } = await deployQueueFixture();

            await queue.connect(operator).setProofRequestQueueFee(PROOF_REQUEST_QUEUE_FEE * 2n);

            await expect(
                queue
                    .connect(consumer)
                    .requestProof(SLOT_KEY_A, [COLLECTION_KEY_A], {
                        value: PROOF_REQUEST_QUEUE_FEE,
                    })
            ).to.be.revertedWithCustomError(queue, 'InsufficientFee');
        });
    });

    // -----------------------------------------------------------
    // setOperator
    // -----------------------------------------------------------
    describe('setOperator', function () {
        it('Should allow the operator to rotate to a new operator', async function () {
            const { queue, operator, other } = await deployQueueFixture();

            await expect(queue.connect(operator).setOperator(other.address))
                .to.emit(queue, 'OperatorSet')
                .withArgs(operator.address, other.address);

            expect(await queue.operator()).to.equal(other.address);
        });

        it('Should revoke access from the old operator after rotation', async function () {
            const { queue, operator, other } = await deployQueueFixture();

            await queue.connect(operator).setOperator(other.address);

            await expect(
                queue.connect(operator).setProofRequestQueueFee(0n)
            ).to.be.revertedWithCustomError(queue, 'NotOperator');

            await queue.connect(other).setProofRequestQueueFee(0n);
        });

        it('Should revert if a non-operator rotates the operator', async function () {
            const { queue, consumer, other } = await deployQueueFixture();

            await expect(
                queue.connect(consumer).setOperator(other.address)
            ).to.be.revertedWithCustomError(queue, 'NotOperator');
        });

        it('Should revert if rotating to the zero address', async function () {
            const { queue, operator } = await deployQueueFixture();

            await expect(
                queue.connect(operator).setOperator(ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(queue, 'ZeroAddress');
        });

        it('Should not disturb the provable slots', async function () {
            const { queue, operator, consumer, other } = await deployQueueFixture();
            const queueAddress = await queue.getAddress();

            await queue
                .connect(consumer)
                .requestProof(SLOT_KEY_A, [COLLECTION_KEY_A], {
                    value: PROOF_REQUEST_QUEUE_FEE,
                });
            await queue.connect(operator).setOperator(other.address);

            expect(await readStorage(queueAddress, HEAD_SLOT_INDEX)).to.equal(1n);
            expect(await readStorage(queueAddress, entryBaseSlot(0n))).to.equal(
                BigInt(consumer.address)
            );
        });
    });

    // -----------------------------------------------------------
    // setFeeRecipient
    // -----------------------------------------------------------
    describe('setFeeRecipient', function () {
        it('Should allow the operator to set the fee recipient and emit the event', async function () {
            const { queue, operator, treasury, other } = await deployQueueFixture();

            await expect(queue.connect(operator).setFeeRecipient(other.address))
                .to.emit(queue, 'FeeRecipientSet')
                .withArgs(treasury.address, other.address);

            expect(await queue.feeRecipient()).to.equal(other.address);
        });

        it('Should revert if a non-operator sets the fee recipient', async function () {
            const { queue, consumer, other } = await deployQueueFixture();

            await expect(
                queue.connect(consumer).setFeeRecipient(other.address)
            ).to.be.revertedWithCustomError(queue, 'NotOperator');
        });

        it('Should revert if setting the fee recipient to the zero address', async function () {
            const { queue, operator } = await deployQueueFixture();

            await expect(
                queue.connect(operator).setFeeRecipient(ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(queue, 'ZeroAddress');
        });
    });

    // -----------------------------------------------------------
    // withdrawFees
    // -----------------------------------------------------------
    describe('withdrawFees', function () {
        it('Should allow the fee recipient to withdraw accumulated fees', async function () {
            const { queue, consumer, treasury } = await deployQueueFixture();

            await queue
                .connect(consumer)
                .requestProof(SLOT_KEY_A, [COLLECTION_KEY_A], {
                    value: PROOF_REQUEST_QUEUE_FEE,
                });

            const balanceBefore = await ethers.provider.getBalance(
                treasury.address
            );
            const tx = await queue.connect(treasury).withdrawFees();
            const receipt = await tx.wait();
            if (!receipt) throw new Error('Tx not mined');
            const gasUsed = receipt.gasUsed * receipt.gasPrice;
            const balanceAfter = await ethers.provider.getBalance(
                treasury.address
            );

            expect(balanceAfter - balanceBefore + gasUsed).to.equal(PROOF_REQUEST_QUEUE_FEE);
            expect(await queue.accumulatedFees()).to.equal(0n);
        });

        it('Should emit FeesWithdrawn', async function () {
            const { queue, consumer, treasury } = await deployQueueFixture();

            await queue
                .connect(consumer)
                .requestProof(SLOT_KEY_A, [COLLECTION_KEY_A], {
                    value: PROOF_REQUEST_QUEUE_FEE,
                });

            await expect(queue.connect(treasury).withdrawFees())
                .to.emit(queue, 'FeesWithdrawn')
                .withArgs(treasury.address, PROOF_REQUEST_QUEUE_FEE);
        });

        it('Should revert if the caller is not the fee recipient', async function () {
            const { queue, consumer } = await deployQueueFixture();

            await queue
                .connect(consumer)
                .requestProof(SLOT_KEY_A, [COLLECTION_KEY_A], {
                    value: PROOF_REQUEST_QUEUE_FEE,
                });

            await expect(
                queue.connect(consumer).withdrawFees()
            ).to.be.revertedWithCustomError(queue, 'NotFeeRecipient');
        });

        it('Should revert if the fee recipient is not set', async function () {
            const [operator, consumer] = await ethers.getSigners();
            const Queue = new NoriProofRequestQueue__factory(operator);
            const queue = await Queue.deploy(
                operator.address,
                ethers.ZeroAddress,
                PROOF_REQUEST_QUEUE_FEE
            );

            await queue
                .connect(consumer)
                .requestProof(SLOT_KEY_A, [COLLECTION_KEY_A], {
                    value: PROOF_REQUEST_QUEUE_FEE,
                });

            await expect(
                queue.connect(operator).withdrawFees()
            ).to.be.revertedWithCustomError(queue, 'FeeRecipientNotSet');
        });

        it('Should revert if there are no fees to withdraw', async function () {
            const { queue, treasury } = await deployQueueFixture();

            await expect(
                queue.connect(treasury).withdrawFees()
            ).to.be.revertedWithCustomError(queue, 'NoFeesToWithdraw');
        });

        it('Should not disturb the provable slots', async function () {
            const { queue, consumer, treasury } = await deployQueueFixture();
            const queueAddress = await queue.getAddress();

            await queue
                .connect(consumer)
                .requestProof(SLOT_KEY_A, [COLLECTION_KEY_A], {
                    value: PROOF_REQUEST_QUEUE_FEE,
                });
            await queue.connect(treasury).withdrawFees();

            expect(await readStorage(queueAddress, HEAD_SLOT_INDEX)).to.equal(1n);
            expect(await readStorage(queueAddress, entryBaseSlot(0n))).to.equal(
                BigInt(consumer.address)
            );
        });
    });

    // -----------------------------------------------------------
    // receive
    // -----------------------------------------------------------
    describe('receive', function () {
        it('Should reject plain ETH transfers', async function () {
            const { queue, consumer } = await deployQueueFixture();

            await expect(
                consumer.sendTransaction({
                    to: await queue.getAddress(),
                    value: PROOF_REQUEST_QUEUE_FEE,
                })
            ).to.be.revertedWith('Use requestProof to enqueue a proof request');
        });
    });
});
