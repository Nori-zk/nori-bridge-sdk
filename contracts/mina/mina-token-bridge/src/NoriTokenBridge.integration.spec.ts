/**
 * NoriTokenBridge Integration Test Suite
 *
 * Tests the consolidated NoriTokenBridge contract using a LocalBlockchain
 * (proofsEnabled: false) for fast, network-free execution.
 *
 * Tests run against an in-memory Mina LocalBlockchain.
 * No running Lightnet node required.
 *
 * Test sequence (order-dependent, shared state):
 *   1. Deploy contracts
 *   2. test update() — Ethereum state transitions (series of 4 blocks)
 *   3. test setUpStorage() — per-user storage initialisation
 *   4. test noriMint() — token minting
 *   5. Admin operation tests
 */

import { Logger, LogPrinter } from 'esm-iso-logger';
import {
    AccountUpdate,
    Bool,
    fetchAccount,
    Field,
    Mina,
    Poseidon,
    PrivateKey,
    type PublicKey,
    UInt64,
    UInt8,
} from 'o1js';
// VerificationKey must be a value import for @method decorator runtime validation
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { VerificationKey } from 'o1js';
import assert from 'node:assert';
import { FungibleToken } from './TokenBase.js';
import { NoriStorageInterface } from './NoriStorageInterface.js';
import { NoriTokenBridge } from './NoriTokenBridge.js';
import {
    buildContractDepositLeaves,
    ContractDeposit,
    MerkleTreeContractDepositAttestorInput,
    MerklePath,
} from './depositAttestation.js';
import {
    createCodeChallenge,
    obtainCodeVerifierFromEthSignature,
} from './pkarm.js';
import {
    EthInput,
    NodeProofLeft,
    decodeConsensusMptProof,
    Bytes32,
    Bytes32FieldPair,
    foldMerkleLeft,
    computeMerkleTreeDepthAndSize,
    getMerklePathFromLeaves,
    getMerkleZeros,
    Bytes20,
} from '@nori-zk/o1js-zk-utils';
// NodeProofLeft from o1js-zk-utils is patched to Subclass<typeof DynamicProof> for fromJSON().
// NoriTokenBridge.update() takes the raw proof-conversion type. Cast with `as any` at call sites.
import type { NodeProofLeft as NodeProofLeftRaw } from '@nori-zk/proof-conversion/min';
import { buildExampleProofSeriesCreateArguments } from './constructExampleProofs.js';

new LogPrinter('TestNoriTokenBridgeIntegration');
const logger = new Logger('NoriTokenBridgeIntegrationSpec');

const FEE = Number(process.env.TX_FEE ?? 0.1) * 1e9;

type Keypair = { publicKey: PublicKey; privateKey: PrivateKey };

// ---------------------------------------------------------------------------
// Shared test state (populated in beforeAll)
// ---------------------------------------------------------------------------
let deployer: Keypair;
let admin: Keypair;
let alice: Keypair;

let tokenBaseKeypair: Keypair;
let tokenBase: FungibleToken;

let noriTokenBridgeKeypair: Keypair;
let noriTokenBridge: NoriTokenBridge;

let storageInterfaceVK: VerificationKey;
let tokenBaseVK: VerificationKey;

let allAccounts: PublicKey[];

// Decoded proof inputs — populated once in beforeAll
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RawProof = NodeProofLeftRaw;
let ethInput1: EthInput;
let rawProof1: RawProof;
let ethInput2: EthInput;
let rawProof2: RawProof;
let ethInput3: EthInput;
let rawProof3: RawProof;
let ethInput4: EthInput;
let rawProof4: RawProof;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function txSend({
    body,
    sender,
    signers,
    fee: txFee = FEE,
}: {
    body: () => Promise<void>;
    sender: PublicKey;
    signers: PrivateKey[];
    fee?: number;
}) {
    const tx = await Mina.transaction({ sender, fee: txFee }, body);
    await tx.prove();
    tx.sign(signers);
    const pendingTx = await tx.send();
    return pendingTx.wait();
}

async function fetchAccounts(addrs: PublicKey[]) {
    await Promise.all(addrs.map((addr) => fetchAccount({ publicKey: addr })));
}

/**
 * Build a self-consistent synthetic deposit for noriMint() tests.
 */
function buildSyntheticDeposit(
    recipientPublicKey: PublicKey,
    ethAddressHex: string,        // 40-char hex without 0x
    ethSig65Hex: string,          // 130-char hex without 0x (65 bytes)
    totalWei: bigint = 2_000_000_000_000n
): {
    merkleInput: MerkleTreeContractDepositAttestorInput;
    codeVerifier: Field;
} {
    const codeVerifier = obtainCodeVerifierFromEthSignature(`0x${ethSig65Hex}`);
    const codeChallenge = createCodeChallenge(codeVerifier, recipientPublicKey);
    const codeChallengeHex = codeChallenge.toBigInt().toString(16).padStart(64, '0');
    const valueHex = totalWei.toString(16).padStart(64, '0');

    const deposit = new ContractDeposit({
        address: Bytes20.fromHex(ethAddressHex),
        attestationHash: Bytes32.fromHex(codeChallengeHex),
        value: Bytes32.fromHex(valueHex),
    });

    const leaves = buildContractDepositLeaves([deposit]);
    const { depth, paddedSize } = computeMerkleTreeDepthAndSize(leaves.length);
    const zeros = getMerkleZeros(depth);
    const path = getMerklePathFromLeaves([...leaves], paddedSize, depth, 0, zeros);
    const rootHash = foldMerkleLeft(leaves, paddedSize, depth, zeros);

    const merklePath = MerklePath.from([]);
    path.forEach((p) => merklePath.push(p));

    const merkleInput = new MerkleTreeContractDepositAttestorInput({
        rootHash,
        path: merklePath,
        index: UInt64.fromValue(0),
        value: deposit,
    });

    return { merkleInput, codeVerifier };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe('NoriTokenBridge', () => {
    beforeAll(async () => {
        // Configure LocalBlockchain (proofsEnabled: false for fast execution)
        const Local = await Mina.LocalBlockchain({ proofsEnabled: false });
        Mina.setActiveInstance(Local);

        deployer = {
            publicKey: Local.testAccounts[0].publicKey,
            privateKey: Local.testAccounts[0].key,
        };
        admin = {
            publicKey: Local.testAccounts[1].publicKey,
            privateKey: Local.testAccounts[1].key,
        };
        alice = {
            publicKey: Local.testAccounts[2].publicKey,
            privateKey: Local.testAccounts[2].key,
        };

        tokenBaseKeypair = PrivateKey.randomKeypair();
        noriTokenBridgeKeypair = PrivateKey.randomKeypair();

        tokenBase = new FungibleToken(tokenBaseKeypair.publicKey);
        noriTokenBridge = new NoriTokenBridge(noriTokenBridgeKeypair.publicKey);

        allAccounts = [
            deployer.publicKey,
            admin.publicKey,
            alice.publicKey,
            tokenBaseKeypair.publicKey,
            noriTokenBridgeKeypair.publicKey,
        ];

        logger.log(`
      deployer        ${deployer.publicKey.toBase58()}
      admin           ${admin.publicKey.toBase58()}
      alice           ${alice.publicKey.toBase58()}
      tokenBase       ${tokenBaseKeypair.publicKey.toBase58()}
      noriTokenBridge ${noriTokenBridgeKeypair.publicKey.toBase58()}
    `);

        // Compile in dependency order.
        logger.log('Compiling NoriStorageInterface...');
        storageInterfaceVK = (await NoriStorageInterface.compile()).verificationKey;
        logger.log('Compiling FungibleToken...');
        tokenBaseVK = (await FungibleToken.compile()).verificationKey;
        logger.log('Compiling NoriTokenBridge...');
        noriTokenBridgeVK = (await NoriTokenBridge.compile()).verificationKey;
        logger.log('All contracts compiled.');

        // Decode example proofs using common helpers
        logger.log('Decoding test example proofs...');
        const examples = buildExampleProofSeriesCreateArguments();

        const decoded1 = decodeConsensusMptProof(examples[0].sp1PlonkProof);
        ethInput1 = new EthInput(decoded1);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rawProof1 = await NodeProofLeft.fromJSON(examples[0].conversionOutputProof.proofData) as any;

        const decoded2 = decodeConsensusMptProof(examples[1].sp1PlonkProof);
        ethInput2 = new EthInput(decoded2);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rawProof2 = await NodeProofLeft.fromJSON(examples[1].conversionOutputProof.proofData) as any;

        const decoded3 = decodeConsensusMptProof(examples[2].sp1PlonkProof);
        ethInput3 = new EthInput(decoded3);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rawProof3 = await NodeProofLeft.fromJSON(examples[2].conversionOutputProof.proofData) as any;

        const decoded4 = decodeConsensusMptProof(examples[3].sp1PlonkProof);
        ethInput4 = new EthInput(decoded4);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rawProof4 = await NodeProofLeft.fromJSON(examples[3].conversionOutputProof.proofData) as any;
        logger.log('All example proofs decoded.');
    }, 1_000_000);

    beforeEach(async () => {
        await fetchAccounts(allAccounts);
    });

    // =======================================================================
    // Deployment
    // =======================================================================
    describe('Deployment', () => {
        test('should deploy NoriTokenBridge and FungibleToken', async () => {
            const initialStoreHash = Bytes32FieldPair.fromBytes32(ethInput1.inputStoreHash);

            await txSend({
                body: async () => {
                    AccountUpdate.fundNewAccount(deployer.publicKey, 3);

                    await noriTokenBridge.deploy({
                        adminPublicKey: admin.publicKey,
                        tokenBaseAddress: tokenBaseKeypair.publicKey,
                        storageVKHash: storageInterfaceVK.hash,
                        newStoreHash: initialStoreHash,
                    });

                    await tokenBase.deploy({
                        symbol: 'nETH',
                        src: 'https://github.com/2nori/nori-bridge-sdk',
                        allowUpdates: true,
                    });

                    await tokenBase.initialize(
                        noriTokenBridgeKeypair.publicKey,
                        UInt8.from(6),
                        Bool(false)
                    );
                },
                sender: deployer.publicKey,
                signers: [
                    deployer.privateKey,
                    noriTokenBridgeKeypair.privateKey,
                    tokenBaseKeypair.privateKey,
                ],
            });

            const onchainAdmin = await noriTokenBridge.adminPublicKey.fetch();
            assert.equal(
                onchainAdmin.toBase58(),
                admin.publicKey.toBase58(),
                'adminPublicKey mismatch'
            );

            const onchainTokenBase = await noriTokenBridge.tokenBaseAddress.fetch();
            assert.equal(
                onchainTokenBase.toBase58(),
                tokenBaseKeypair.publicKey.toBase58(),
                'tokenBaseAddress mismatch'
            );

            const onchainStorageVKHash = await noriTokenBridge.storageVKHash.fetch();
            assert.equal(
                onchainStorageVKHash.toBigInt(),
                storageInterfaceVK.hash.toBigInt(),
                'storageVKHash mismatch'
            );

            const mintLock = await noriTokenBridge.mintLock.fetch();
            assert.equal(mintLock.toBoolean(), true, 'mintLock should be true after deploy');

            const latestHead = await noriTokenBridge.latestHead.fetch();
            assert.equal(latestHead.toBigInt(), 0n, 'latestHead should start at 0');

            const highByte = await noriTokenBridge.latestHeliusStoreInputHashHighByte.fetch();
            const lowerBytes = await noriTokenBridge.latestHeliusStoreInputHashLowerBytes.fetch();
            assert.equal(
                highByte.toBigInt(),
                initialStoreHash.highByteField.toBigInt(),
                'initial store hash high byte mismatch'
            );
            assert.equal(
                lowerBytes.toBigInt(),
                initialStoreHash.lowerBytesField.toBigInt(),
                'initial store hash lower bytes mismatch'
            );

            const onchainDecimals = await tokenBase.decimals.fetch();
            assert.equal(onchainDecimals.toBigInt(), 6n, 'token decimals mismatch');

            logger.log('Deployment verified.');
        }, 1_000_000);
    });

    // =======================================================================
    // update() — Ethereum state verification
    // =======================================================================
    describe('update() — block 1 (happy path)', () => {
        test('should accept the first SP1 proof and advance latestHead (block 1)', async () => {
            const headBefore = await noriTokenBridge.latestHead.fetch();

            await txSend({
                body: async () => {
                    await noriTokenBridge.update(ethInput1, rawProof1);
                },
                sender: deployer.publicKey,
                signers: [deployer.privateKey],
            });

            await fetchAccount({ publicKey: noriTokenBridgeKeypair.publicKey });

            const headAfter = await noriTokenBridge.latestHead.fetch();
            assert.ok(
                headAfter.greaterThan(headBefore).toBoolean(),
                `latestHead must advance: was ${headBefore}, now ${headAfter}`
            );
            assert.equal(
                headAfter.toBigInt(),
                ethInput1.outputSlot.toBigInt(),
                'latestHead must equal proof outputSlot'
            );

            const expectedPair = Bytes32FieldPair.fromBytes32(ethInput1.outputStoreHash);
            const hb = await noriTokenBridge.latestHeliusStoreInputHashHighByte.fetch();
            const lb = await noriTokenBridge.latestHeliusStoreInputHashLowerBytes.fetch();
            assert.equal(hb.toBigInt(), expectedPair.highByteField.toBigInt(), 'store hash high byte');
            assert.equal(lb.toBigInt(), expectedPair.lowerBytesField.toBigInt(), 'store hash lower bytes');

            logger.log(`latestHead advanced to slot ${headAfter} (block 1)`);
        }, 1_000_000);
    });

    describe('update() — blocks 2–4 and negative tests', () => {
        test('should accept block 2 (consecutive from block 1)', async () => {
            await txSend({
                body: async () => {
                    await noriTokenBridge.update(ethInput2, rawProof2);
                },
                sender: deployer.publicKey,
                signers: [deployer.privateKey],
            });

            await fetchAccount({ publicKey: noriTokenBridgeKeypair.publicKey });
            const head = await noriTokenBridge.latestHead.fetch();
            assert.equal(head.toBigInt(), ethInput2.outputSlot.toBigInt(), 'latestHead after block 2');
            logger.log(`latestHead advanced to slot ${head} (block 2)`);
        }, 1_000_000);

        test('should accept block 3 (consecutive from block 2)', async () => {
            await txSend({
                body: async () => {
                    await noriTokenBridge.update(ethInput3, rawProof3);
                },
                sender: deployer.publicKey,
                signers: [deployer.privateKey],
            });

            await fetchAccount({ publicKey: noriTokenBridgeKeypair.publicKey });
            const head = await noriTokenBridge.latestHead.fetch();
            assert.equal(head.toBigInt(), ethInput3.outputSlot.toBigInt(), 'latestHead after block 3');
            logger.log(`latestHead advanced to slot ${head} (block 3)`);
        }, 1_000_000);

        test('should accept block 4 (consecutive from block 3)', async () => {
            await txSend({
                body: async () => {
                    await noriTokenBridge.update(ethInput4, rawProof4);
                },
                sender: deployer.publicKey,
                signers: [deployer.privateKey],
            });

            await fetchAccount({ publicKey: noriTokenBridgeKeypair.publicKey });
            const head = await noriTokenBridge.latestHead.fetch();
            assert.equal(head.toBigInt(), ethInput4.outputSlot.toBigInt(), 'latestHead after block 4');
            logger.log(`latestHead advanced to slot ${head} (block 4)`);
        }, 1_000_000);

        test('should REJECT replay of old proof (slot not greater than current)', async () => {
            await assert.rejects(
                () =>
                    txSend({
                        body: async () => {
                            await noriTokenBridge.update(ethInput1, rawProof1);
                        },
                        sender: deployer.publicKey,
                        signers: [deployer.privateKey],
                    }),
                'Replay of old proof must fail'
            );
        }, 1_000_000);

        test('should REJECT out-of-order proof (store hash chain broken)', async () => {
            await assert.rejects(
                () =>
                    txSend({
                        body: async () => {
                            await noriTokenBridge.update(ethInput2, rawProof2);
                        },
                        sender: deployer.publicKey,
                        signers: [deployer.privateKey],
                    }),
                'Out-of-order proof (store hash mismatch) must fail'
            );
        }, 1_000_000);

        test('verifiedStateRoot should equal Poseidon(executionStateRoot) from last proof', async () => {
            await fetchAccount({ publicKey: noriTokenBridgeKeypair.publicKey });
            const onchain = await noriTokenBridge.verifiedStateRoot.fetch();
            const expected = Poseidon.hashPacked(Bytes32.provable, ethInput4.executionStateRoot);
            assert.equal(
                onchain.toBigInt(),
                expected.toBigInt(),
                'verifiedStateRoot must equal Poseidon(executionStateRoot)'
            );
        }, 1_000_000);

        test('latestVerifiedContractDepositsRoot should match last proof output', async () => {
            await fetchAccount({ publicKey: noriTokenBridgeKeypair.publicKey });
            const hb = await noriTokenBridge.latestVerifiedContractDepositsRootHighByte.fetch();
            const lb = await noriTokenBridge.latestVerifiedContractDepositsRootLowerBytes.fetch();
            const expected = Bytes32FieldPair.fromBytes32(ethInput4.verifiedContractDepositsRoot);
            assert.equal(hb.toBigInt(), expected.highByteField.toBigInt(), 'deposits root high byte');
            assert.equal(lb.toBigInt(), expected.lowerBytesField.toBigInt(), 'deposits root lower bytes');
        }, 1_000_000);
    });

    // =======================================================================
    // setUpStorage() — Per-user storage initialisation
    // =======================================================================
    describe('setUpStorage()', () => {
        test('should initialise storage for Alice', async () => {
            await txSend({
                body: async () => {
                    AccountUpdate.fundNewAccount(alice.publicKey, 1);
                    await noriTokenBridge.setUpStorage(alice.publicKey, storageInterfaceVK);
                },
                sender: alice.publicKey,
                signers: [alice.privateKey],
            });

            const storage = new NoriStorageInterface(
                alice.publicKey,
                noriTokenBridge.deriveTokenId()
            );

            const userKeyHash = await storage.userKeyHash.fetch();
            assert.equal(
                userKeyHash.toBigInt(),
                Poseidon.hash(alice.publicKey.toFields()).toBigInt(),
                'userKeyHash must be Poseidon(alicePublicKey)'
            );

            const mintedSoFar = await storage.mintedSoFar.fetch();
            assert.equal(mintedSoFar.toBigInt(), 0n, 'mintedSoFar must start at 0');
        }, 1_000_000);
    });

    describe('setUpStorage() — negative tests', () => {
        test('should REJECT duplicate storage setup for Alice', async () => {
            await assert.rejects(
                () =>
                    txSend({
                        body: async () => {
                            await noriTokenBridge.setUpStorage(
                                alice.publicKey,
                                storageInterfaceVK
                            );
                        },
                        sender: alice.publicKey,
                        signers: [alice.privateKey],
                    }),
                'Duplicate setUpStorage must fail'
            );
        }, 1_000_000);

        test('should REJECT storage setup with wrong VK (hash mismatch)', async () => {
            const bob = PrivateKey.randomKeypair();
            await assert.rejects(
                () =>
                    txSend({
                        body: async () => {
                            AccountUpdate.fundNewAccount(deployer.publicKey, 1);
                            await noriTokenBridge.setUpStorage(bob.publicKey, tokenBaseVK);
                        },
                        sender: deployer.publicKey,
                        signers: [deployer.privateKey, bob.privateKey],
                    }),
                'Wrong VK in setUpStorage must fail'
            );
        }, 1_000_000);

        test('should REJECT direct mintedSoFar manipulation without a valid proof', async () => {
            const storage = new NoriStorageInterface(
                alice.publicKey,
                noriTokenBridge.deriveTokenId()
            );
            const before = await storage.mintedSoFar.fetch();

            await txSend({
                body: async () => {
                    const tokenAccUpdate = AccountUpdate.createSigned(
                        alice.publicKey,
                        noriTokenBridge.deriveTokenId()
                    );
                    AccountUpdate.setValue(
                        tokenAccUpdate.update.appState[1], // NoriStorageInterface.mintedSoFar
                        Field(9_999_999)
                    );
                    tokenBase.approve(tokenAccUpdate);
                },
                sender: alice.publicKey,
                signers: [alice.privateKey, tokenBaseKeypair.privateKey],
            });

            const after = await storage.mintedSoFar.fetch();
            assert.equal(
                after.toBigInt(),
                before.toBigInt(),
                'mintedSoFar must not change without a valid proof'
            );
        }, 1_000_000);
    });

    // =======================================================================
    // noriMint() — Token minting
    // =======================================================================
    describe('noriMint()', () => {
        let aliceMerkleInput: MerkleTreeContractDepositAttestorInput;
        let aliceCodeVerifier: Field;

        const ALICE_ETH_SIG = 'ab'.repeat(32) + 'cd'.repeat(32) + '1b';
        const ALICE_ETH_ADDR = 'aa'.repeat(20);

        beforeAll(() => {
            const result = buildSyntheticDeposit(
                alice.publicKey,
                ALICE_ETH_ADDR,
                ALICE_ETH_SIG,
                2_000_000_000_000n
            );
            aliceMerkleInput = result.merkleInput;
            aliceCodeVerifier = result.codeVerifier;
            logger.log(`Alice synthetic deposit built. rootHash=${aliceMerkleInput.rootHash.toBigInt()}`);
        });

        // TODO (deposit-root check): Once noriMint() re-enables the deposit-root assertion,
        // this test must first call update() with a block whose verifiedContractDepositsRoot
        // equals aliceMerkleInput.rootHash. For now the check is skipped on-chain.

        test('should mint 2 bridge units for Alice on first deposit', async () => {
            await txSend({
                body: async () => {
                    AccountUpdate.fundNewAccount(alice.publicKey, 1);
                    await noriTokenBridge.noriMint(aliceMerkleInput, aliceCodeVerifier);
                },
                sender: alice.publicKey,
                signers: [alice.privateKey],
            });

            await fetchAccount({
                publicKey: alice.publicKey,
                tokenId: tokenBase.deriveTokenId(),
            });

            const balance = await tokenBase.getBalanceOf(alice.publicKey);
            assert.equal(balance.toBigInt(), 2n, 'Alice should hold 2 bridge units');

            const storage = new NoriStorageInterface(
                alice.publicKey,
                noriTokenBridge.deriveTokenId()
            );
            const mintedSoFar = await storage.mintedSoFar.fetch();
            assert.equal(mintedSoFar.toBigInt(), 2n, 'mintedSoFar should record 2 bridge units');

            logger.log(`Alice minted ${balance} bridge units successfully.`);
        }, 1_000_000);

        describe('noriMint() — negative tests', () => {
            test('should REJECT double-mint with the same deposit (zero new amount)', async () => {
                await assert.rejects(
                    () =>
                        txSend({
                            body: async () => {
                                await noriTokenBridge.noriMint(aliceMerkleInput, aliceCodeVerifier);
                            },
                            sender: alice.publicKey,
                            signers: [alice.privateKey],
                        }),
                    'Double-mint with same deposit must fail'
                );
            }, 1_000_000);

            test('should REJECT mint when totalLocked < 1 bridge unit (< 1e12 wei)', async () => {
                const bob = PrivateKey.randomKeypair();
                const BOB_SIG = 'ff'.repeat(32) + 'ee'.repeat(32) + '1c';
                const BOB_ADDR = 'bb'.repeat(20);
                const { merkleInput: bobInput, codeVerifier: bobVerifier } = buildSyntheticDeposit(
                    bob.publicKey,
                    BOB_ADDR,
                    BOB_SIG,
                    999_999_999_999n
                );

                await txSend({
                    body: async () => {
                        AccountUpdate.fundNewAccount(deployer.publicKey, 1);
                        await noriTokenBridge.setUpStorage(bob.publicKey, storageInterfaceVK);
                    },
                    sender: deployer.publicKey,
                    signers: [deployer.privateKey, bob.privateKey],
                });

                await assert.rejects(
                    () =>
                        txSend({
                            body: async () => {
                                AccountUpdate.fundNewAccount(deployer.publicKey, 1);
                                await noriTokenBridge.noriMint(bobInput, bobVerifier);
                            },
                            sender: bob.publicKey,
                            signers: [bob.privateKey],
                        }),
                    'Mint with totalLocked < 1e12 wei must fail'
                );
            }, 1_000_000);

            test('should REJECT mint with wrong PKARM codeVerifier', async () => {
                const wrongSig = 'de'.repeat(32) + 'ad'.repeat(32) + '1b';
                const wrongVerifier = obtainCodeVerifierFromEthSignature(`0x${wrongSig}`);

                await assert.rejects(
                    () =>
                        txSend({
                            body: async () => {
                                await noriTokenBridge.noriMint(aliceMerkleInput, wrongVerifier);
                            },
                            sender: alice.publicKey,
                            signers: [alice.privateKey],
                        }),
                    'Wrong PKARM codeVerifier must fail'
                );
            }, 1_000_000);

            test('should REJECT mint without storage setup (storage.account.isNew must be false)', async () => {
                const charlie = PrivateKey.randomKeypair();
                const CHARLIE_SIG = '12'.repeat(32) + '34'.repeat(32) + '1c';
                const CHARLIE_ADDR = 'cc'.repeat(20);
                const { merkleInput: charlieInput, codeVerifier: charlieVerifier } = buildSyntheticDeposit(
                    charlie.publicKey,
                    CHARLIE_ADDR,
                    CHARLIE_SIG,
                    2_000_000_000_000n
                );

                await assert.rejects(
                    () =>
                        txSend({
                            body: async () => {
                                AccountUpdate.fundNewAccount(charlie.publicKey, 1);
                                await noriTokenBridge.noriMint(charlieInput, charlieVerifier);
                            },
                            sender: charlie.publicKey,
                            signers: [charlie.privateKey],
                        }),
                    'Minting without storage setup must fail'
                );
            }, 1_000_000);

            test('should REJECT cross-user PKARM attack (wrong sender cannot claim Alice deposit)', async () => {
                const eve = PrivateKey.randomKeypair();

                await txSend({
                    body: async () => {
                        AccountUpdate.fundNewAccount(deployer.publicKey, 1);
                        await noriTokenBridge.setUpStorage(eve.publicKey, storageInterfaceVK);
                    },
                    sender: deployer.publicKey,
                    signers: [deployer.privateKey, eve.privateKey],
                });

                await assert.rejects(
                    () =>
                        txSend({
                            body: async () => {
                                AccountUpdate.fundNewAccount(eve.publicKey, 1);
                                await noriTokenBridge.noriMint(aliceMerkleInput, aliceCodeVerifier);
                            },
                            sender: eve.publicKey,
                            signers: [eve.privateKey],
                        }),
                    'Cross-user PKARM attack must fail'
                );
            }, 1_000_000);

            test('should REJECT direct FungibleToken.mint() call (bypassing NoriTokenBridge)', async () => {
                await assert.rejects(
                    () =>
                        txSend({
                            body: async () => {
                                await tokenBase.mint(alice.publicKey, UInt64.from(100));
                            },
                            sender: alice.publicKey,
                            signers: [
                                alice.privateKey,
                                tokenBaseKeypair.privateKey,
                                noriTokenBridgeKeypair.privateKey,
                            ],
                        }),
                    'Direct FungibleToken.mint() must fail (canMint guards via mintLock)'
                );
            }, 1_000_000);
        });
    });

    // =======================================================================
    // Admin operations
    // =======================================================================
    describe('Admin operations', () => {
        test('updateStoreHash() should succeed with admin signature', async () => {
            const newBytes = new Array(32).fill(0).map((_, i) => i % 256);
            const newStoreHash = Bytes32FieldPair.fromBytes32(Bytes32.from(newBytes));

            await txSend({
                body: async () => {
                    await noriTokenBridge.updateStoreHash(newStoreHash);
                },
                sender: admin.publicKey,
                signers: [admin.privateKey],
            });

            await fetchAccount({ publicKey: noriTokenBridgeKeypair.publicKey });
            const hb = await noriTokenBridge.latestHeliusStoreInputHashHighByte.fetch();
            const lb = await noriTokenBridge.latestHeliusStoreInputHashLowerBytes.fetch();
            assert.equal(hb.toBigInt(), newStoreHash.highByteField.toBigInt(), 'high byte after updateStoreHash');
            assert.equal(lb.toBigInt(), newStoreHash.lowerBytesField.toBigInt(), 'lower bytes after updateStoreHash');
        }, 1_000_000);

        test('updateStoreHash() should REJECT without admin signature', async () => {
            const newStoreHash = Bytes32FieldPair.fromBytes32(Bytes32.from(new Array(32).fill(99)));
            await assert.rejects(
                () =>
                    txSend({
                        body: async () => {
                            await noriTokenBridge.updateStoreHash(newStoreHash);
                        },
                        sender: alice.publicKey,
                        signers: [alice.privateKey],
                    }),
                'updateStoreHash() without admin must fail'
            );
        }, 1_000_000);

        test('updateVerificationKey() should succeed with admin signature', async () => {
            const freshVK = (await NoriTokenBridge.compile()).verificationKey;
            await txSend({
                body: async () => {
                    await noriTokenBridge.updateVerificationKey(freshVK);
                },
                sender: admin.publicKey,
                signers: [admin.privateKey],
            });
            logger.log('updateVerificationKey() succeeded.');
        }, 1_000_000);

        test('updateVerificationKey() should REJECT without admin signature', async () => {
            const freshVK = (await NoriTokenBridge.compile()).verificationKey;
            await assert.rejects(
                () =>
                    txSend({
                        body: async () => {
                            await noriTokenBridge.updateVerificationKey(freshVK);
                        },
                        sender: alice.publicKey,
                        signers: [alice.privateKey],
                    }),
                'updateVerificationKey() without admin must fail'
            );
        }, 1_000_000);
    });
});
