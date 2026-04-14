/**
 * NoriTokenBridge E2E Test Suite (Lightnet)
 *
 * Tests the consolidated NoriTokenBridge contract against a local Lightnet Mina node.
 * Requires: Lightnet running at http://localhost:8080/graphql (accountManager at :8181)
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
    type NetworkId,
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
    type MerkleTreeContractDepositAttestorInput,
    getContractDepositSlotRootFromContractDepositAndWitness,
} from './depositAttestation.js';
import type { SCRAMWitness } from './scram.js';
import {
    EthInput,
    NodeProofLeft,
    decodeConsensusMptProof,
    Bytes32,
    Bytes32FieldPair,
    bytes32LEToFieldProvable,
    extractEthTokenBridgeAddressFromSP1Proof,
    bridgeHeadNoriSP1HeliosProgramPi0,
    proofConversionSP1ToPlonkPO2,
} from '@nori-zk/o1js-zk-utils-new';
// NodeProofLeft from o1js-zk-utils is patched to Subclass<typeof DynamicProof> for fromJSON().
// NoriTokenBridge.update() takes the raw proof-conversion type.
import type { NodeProofLeft as NodeProofLeftRaw } from '@nori-zk/proof-conversion/min';
import { FrC } from '@nori-zk/proof-conversion/min';
import { buildExampleProofSeriesCreateArguments } from './constructExampleProofs.js';
import { getNewMinaLiteNetAccountKeyPair, keyPairBase58ToKeyPair, buildSyntheticDeposit } from './testUtils.js';

new LogPrinter('TestMinaNoriTokenBridge');
const logger = new Logger('IntegrationLightnetTest');

const fee = Number(process.env.MINA_TX_FEE ?? 0.1) * 1e9;

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
let noriTokenBridgeVK: VerificationKey;
void noriTokenBridgeVK;
let tokenBaseVK: VerificationKey;

let allAccounts: PublicKey[];

const examples = buildExampleProofSeriesCreateArguments();
// Decoded proof inputs — populated once in beforeAll
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
    fee: txFee = fee,
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


// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe('NoriTokenBridge', () => {
    beforeAll(async () => {
        // Configure Lightnet
        const Network = Mina.Network({
            networkId: 'testnet' as NetworkId,
            mina: process.env.MINA_RPC_NETWORK_URL ?? 'http://localhost:8080/graphql',
            // accountManager: process.env.MINA_ACCOUNT_MANAGER_URL ?? 'http://localhost:8181',
            archive: process.env.MINA_ARCHIVE_RPC_URL ?? 'http://localhost:8282',
        });
        Mina.setActiveInstance(Network);

        deployer = keyPairBase58ToKeyPair(await getNewMinaLiteNetAccountKeyPair());
        admin = keyPairBase58ToKeyPair(await getNewMinaLiteNetAccountKeyPair());
        alice = keyPairBase58ToKeyPair(await getNewMinaLiteNetAccountKeyPair());

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
        storageInterfaceVK = (await NoriStorageInterface.compile())
            .verificationKey;
        logger.log('Compiling FungibleToken...');
        tokenBaseVK = (await FungibleToken.compile()).verificationKey;
        logger.log('Compiling NoriTokenBridge...');
        noriTokenBridgeVK = (await NoriTokenBridge.compile()).verificationKey;
        logger.log('All contracts compiled.');

        // Decode example proofs using common helpers
        logger.log('Decoding test example proofs...');

        const decoded1 = decodeConsensusMptProof(examples[0].sp1PlonkProof);
        ethInput1 = new EthInput(decoded1);
        rawProof1 = await NodeProofLeft.fromJSON(
            examples[0].conversionOutputProof.proofData
        );

        const decoded2 = decodeConsensusMptProof(examples[1].sp1PlonkProof);
        ethInput2 = new EthInput(decoded2);
        rawProof2 = await NodeProofLeft.fromJSON(
            examples[1].conversionOutputProof.proofData
        );

        const decoded3 = decodeConsensusMptProof(examples[2].sp1PlonkProof);
        ethInput3 = new EthInput(decoded3);
        rawProof3 = await NodeProofLeft.fromJSON(
            examples[2].conversionOutputProof.proofData
        );

        const decoded4 = decodeConsensusMptProof(examples[3].sp1PlonkProof);
        ethInput4 = new EthInput(decoded4);
        rawProof4 = await NodeProofLeft.fromJSON(
            examples[3].conversionOutputProof.proofData
        );
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
            const initialStoreHash = Bytes32FieldPair.fromBytes32(
                ethInput1.inputStoreHash
            );

            await txSend({
                body: async () => {
                    AccountUpdate.fundNewAccount(deployer.publicKey, 3);

                    await noriTokenBridge.deploy({
                        adminPublicKey: admin.publicKey,
                        tokenBaseAddress: tokenBaseKeypair.publicKey,
                        storageVKHash: storageInterfaceVK.hash,
                        newStoreHash: initialStoreHash,
                        ethTokenBridgeAddress: extractEthTokenBridgeAddressFromSP1Proof(examples[0]),
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

            const onchainTokenBase =
                await noriTokenBridge.tokenBaseAddress.fetch();
            assert.equal(
                onchainTokenBase.toBase58(),
                tokenBaseKeypair.publicKey.toBase58(),
                'tokenBaseAddress mismatch'
            );

            const onchainStorageVKHash =
                await noriTokenBridge.storageVKHash.fetch();
            assert.equal(
                onchainStorageVKHash.toBigInt(),
                storageInterfaceVK.hash.toBigInt(),
                'storageVKHash mismatch'
            );

            const mintLock = await noriTokenBridge.mintLock.fetch();
            assert.equal(
                mintLock.toBoolean(),
                true,
                'mintLock should be true after deploy'
            );

            const latestHead = await noriTokenBridge.latestHead.fetch();
            assert.equal(
                latestHead.toBigInt(),
                0n,
                'latestHead should start at 0'
            );

            const highByte =
                await noriTokenBridge.latestHeliusStoreInputHashHighByte.fetch();
            const lowerBytes =
                await noriTokenBridge.latestHeliusStoreInputHashLowerBytes.fetch();
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
            assert.equal(
                onchainDecimals.toBigInt(),
                6n,
                'token decimals mismatch'
            );

            logger.log('Deployment verified.');
        }, 1_000_000);
    });

    // =======================================================================
    // setNoriHeliosProgramPi0() / setProofConversionPO2() — on-chain integrity params
    // =======================================================================
    describe('setNoriHeliosProgramPi0() / setProofConversionPO2()', () => {
        describe('Happy Path', () => {
            test('should set noriHeliosProgramPi0 with admin key', async () => {
                const pi0 = FrC.from(bridgeHeadNoriSP1HeliosProgramPi0);

                await txSend({
                    body: async () => {
                        await noriTokenBridge.setNoriHeliosProgramPi0(pi0);
                    },
                    sender: admin.publicKey,
                    signers: [admin.privateKey],
                });

                await fetchAccount({ publicKey: noriTokenBridgeKeypair.publicKey });
                const onchain = await noriTokenBridge.noriHeliosProgramPi0.fetch();
                FrC.from(onchain).assertEquals(pi0, 'noriHeliosProgramPi0 mismatch');

                logger.log('noriHeliosProgramPi0 set successfully.');
            }, 1_000_000);

            test('should set both pi0 and po2 in a single transaction', async () => {
                const pi0 = FrC.from(bridgeHeadNoriSP1HeliosProgramPi0);
                const po2 = Field.from(proofConversionSP1ToPlonkPO2);

                await txSend({
                    body: async () => {
                        await noriTokenBridge.setNoriHeliosProgramPi0(pi0);
                        await noriTokenBridge.setProofConversionPO2(po2);
                    },
                    sender: admin.publicKey,
                    signers: [admin.privateKey],
                });

                await fetchAccount({ publicKey: noriTokenBridgeKeypair.publicKey });

                const onchainPi0 = await noriTokenBridge.noriHeliosProgramPi0.fetch();
                FrC.from(onchainPi0).assertEquals(pi0, 'noriHeliosProgramPi0 mismatch');

                const onchainPo2 = await noriTokenBridge.proofConversionPO2.fetch();
                assert.equal(onchainPo2.toBigInt(), po2.toBigInt(), 'proofConversionPO2 mismatch');

                logger.log('Both pi0 and po2 set in single transaction.');
            }, 1_000_000);

            test('should set proofConversionPO2 with admin key', async () => {
                const po2 = Field.from(proofConversionSP1ToPlonkPO2);

                await txSend({
                    body: async () => {
                        await noriTokenBridge.setProofConversionPO2(po2);
                    },
                    sender: admin.publicKey,
                    signers: [admin.privateKey],
                });

                await fetchAccount({ publicKey: noriTokenBridgeKeypair.publicKey });
                const onchain = await noriTokenBridge.proofConversionPO2.fetch();
                assert.equal(
                    onchain.toBigInt(),
                    po2.toBigInt(),
                    'proofConversionPO2 mismatch'
                );

                logger.log('proofConversionPO2 set successfully.');
            }, 1_000_000);
        });

        describe('Negative Tests', () => {
            test('should REJECT setNoriHeliosProgramPi0 by arbitrary user', async () => {
                const pi0 = FrC.from(33);

                await assert.rejects(
                    () =>
                        txSend({
                            body: async () => {
                                await noriTokenBridge.setNoriHeliosProgramPi0(pi0);
                            },
                            sender: alice.publicKey,
                            signers: [alice.privateKey],
                        })
                );
            }, 1_000_000);

            test('should REJECT setProofConversionPO2 by arbitrary user', async () => {
                const po2 = Field.from(54);

                await assert.rejects(
                    () =>
                        txSend({
                            body: async () => {
                                await noriTokenBridge.setProofConversionPO2(po2);
                            },
                            sender: alice.publicKey,
                            signers: [alice.privateKey],
                        })
                );
            }, 1_000_000);

            test('should REJECT setNoriHeliosProgramPi0 by deployer (not admin)', async () => {
                const pi0 = FrC.from(43);

                await assert.rejects(
                    () =>
                        txSend({
                            body: async () => {
                                await noriTokenBridge.setNoriHeliosProgramPi0(pi0);
                            },
                            sender: deployer.publicKey,
                            signers: [deployer.privateKey],
                        })
                );
            }, 1_000_000);

            test('should REJECT setProofConversionPO2 by deployer (not admin)', async () => {
                const po2 = Field.from(65);

                await assert.rejects(
                    () =>
                        txSend({
                            body: async () => {
                                await noriTokenBridge.setProofConversionPO2(po2);
                            },
                            sender: deployer.publicKey,
                            signers: [deployer.privateKey],
                        })
                );
            }, 1_000_000);
        });
    });

    // =======================================================================
    // update() — Ethereum state verification
    // =======================================================================
    describe('update()', () => {
        describe('Happy Path', () => {
            test('should accept the first SP1 proof and advance latestHead (block 1)', async () => {
                const headBefore = await noriTokenBridge.latestHead.fetch();

                await txSend({
                    body: async () => {
                        await noriTokenBridge.update(ethInput1, rawProof1, Field(0));
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

                const expectedPair = Bytes32FieldPair.fromBytes32(
                    ethInput1.outputStoreHash
                );
                const hb =
                    await noriTokenBridge.latestHeliusStoreInputHashHighByte.fetch();
                const lb =
                    await noriTokenBridge.latestHeliusStoreInputHashLowerBytes.fetch();
                assert.equal(
                    hb.toBigInt(),
                    expectedPair.highByteField.toBigInt(),
                    'store hash high byte'
                );
                assert.equal(
                    lb.toBigInt(),
                    expectedPair.lowerBytesField.toBigInt(),
                    'store hash lower bytes'
                );

                logger.log(`latestHead advanced to slot ${headAfter} (block 1)`);
            }, 1_000_000);

            test('should accept block 2 (consecutive from block 1)', async () => {
                await txSend({
                    body: async () => {
                        await noriTokenBridge.update(ethInput2, rawProof2, Field(0));
                    },
                    sender: deployer.publicKey,
                    signers: [deployer.privateKey],
                });

                await fetchAccount({ publicKey: noriTokenBridgeKeypair.publicKey });
                const head = await noriTokenBridge.latestHead.fetch();
                assert.equal(
                    head.toBigInt(),
                    ethInput2.outputSlot.toBigInt(),
                    'latestHead after block 2'
                );
                logger.log(`latestHead advanced to slot ${head} (block 2)`);
            }, 1_000_000);

            test('should accept block 3 (consecutive from block 2)', async () => {
                await txSend({
                    body: async () => {
                        await noriTokenBridge.update(ethInput3, rawProof3, Field(0));
                    },
                    sender: deployer.publicKey,
                    signers: [deployer.privateKey],
                });

                await fetchAccount({ publicKey: noriTokenBridgeKeypair.publicKey });
                const head = await noriTokenBridge.latestHead.fetch();
                assert.equal(
                    head.toBigInt(),
                    ethInput3.outputSlot.toBigInt(),
                    'latestHead after block 3'
                );
                logger.log(`latestHead advanced to slot ${head} (block 3)`);
            }, 1_000_000);

            test('should accept block 4 (consecutive from block 3)', async () => {
                await txSend({
                    body: async () => {
                        await noriTokenBridge.update(ethInput4, rawProof4, Field(0));
                    },
                    sender: deployer.publicKey,
                    signers: [deployer.privateKey],
                });

                await fetchAccount({ publicKey: noriTokenBridgeKeypair.publicKey });
                const head = await noriTokenBridge.latestHead.fetch();
                assert.equal(
                    head.toBigInt(),
                    ethInput4.outputSlot.toBigInt(),
                    'latestHead after block 4'
                );
                logger.log(`latestHead advanced to slot ${head} (block 4)`);
            }, 1_000_000);

            test('should REJECT replay of old proof (slot not greater than current)', async () => {
                await assert.rejects(
                    () =>
                        txSend({
                            body: async () => {
                                await noriTokenBridge.update(ethInput1, rawProof1, Field(0));
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
                                await noriTokenBridge.update(ethInput2, rawProof2, Field(0));
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
                const expected = Poseidon.hashPacked(
                    Bytes32.provable,
                    ethInput4.executionStateRoot
                );
                assert.equal(
                    onchain.toBigInt(),
                    expected.toBigInt(),
                    'verifiedStateRoot must equal Poseidon(executionStateRoot)'
                );
            }, 1_000_000);

            test('latestVerifiedContractDepositsRoot should match last proof output', async () => {
                await fetchAccount({ publicKey: noriTokenBridgeKeypair.publicKey });
                // const hb =
                //     await noriTokenBridge.latestVerifiedContractDepositsRootHighByte.fetch();
                // const lb =
                //     await noriTokenBridge.latestVerifiedContractDepositsRootLowerBytes.fetch();
                // const expected = Bytes32FieldPair.fromBytes32(
                //     ethInput4.verifiedContractDepositsRoot
                // );
                // assert.equal(
                //     hb.toBigInt(),
                //     expected.highByteField.toBigInt(),
                //     'deposits root high byte'
                // );
                // assert.equal(
                //     lb.toBigInt(),
                //     expected.lowerBytesField.toBigInt(),
                //     'deposits root lower bytes'
                // );

                const latestVerifiedContractDepositsRoot =
                    await noriTokenBridge.latestVerifiedContractDepositsRoot.fetch();
                const expected = bytes32LEToFieldProvable(
                    ethInput4.verifiedContractDepositsRoot.bytes
                );
                assert.equal(
                    latestVerifiedContractDepositsRoot.toBigInt(),
                    expected.toBigInt(),
                    'deposits root'
                );
            }, 1_000_000);
        });

        describe('Negative Tests', () => {
            test('should REJECT replay of old proof (slot not greater than current)', async () => {
                await assert.rejects(
                    () =>
                        txSend({
                            body: async () => {
                                await noriTokenBridge.update(ethInput1, rawProof1, Field(0));
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
                                await noriTokenBridge.update(ethInput2, rawProof2, Field(0));
                            },
                            sender: deployer.publicKey,
                            signers: [deployer.privateKey],
                        }),
                    'Out-of-order proof (store hash mismatch) must fail'
                );
            }, 1_000_000);
        });
    });

    // =======================================================================
    // setUpStorage() — Per-user storage initialisation
    // =======================================================================
    describe('setUpStorage()', () => {
        describe('Happy Path', () => {
            test('should initialise storage for Alice', async () => {
                await txSend({
                    body: async () => {
                        AccountUpdate.fundNewAccount(alice.publicKey, 1);
                        await noriTokenBridge.setUpStorage(
                            alice.publicKey,
                            storageInterfaceVK
                        );
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
                assert.equal(
                    mintedSoFar.toBigInt(),
                    0n,
                    'mintedSoFar must start at 0'
                );
            }, 1_000_000);
        });

        describe('Negative Tests', () => {
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
                                await noriTokenBridge.setUpStorage(
                                    bob.publicKey,
                                    tokenBaseVK
                                );
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
    });

    // =======================================================================
    // noriMint() — Token minting
    // =======================================================================
    describe('noriMint()', () => {
        let aliceDepositAttestationInput: MerkleTreeContractDepositAttestorInput;
        let aliceSCRAMWitness: SCRAMWitness;

        const aliceScramMsg = 'NoriZK';

        let dave: Keypair;
        let allDispatchedRoots: Field[] = [];
        let daveTotalLocked = 0n;
        let daveMintCount = 0;

        beforeAll(async () => {
            dave = keyPairBase58ToKeyPair(await getNewMinaLiteNetAccountKeyPair());
            allAccounts.push(dave.publicKey);

            const result = buildSyntheticDeposit(
                alice.privateKey,
                aliceScramMsg,
                200n
            );
            aliceDepositAttestationInput = result.merkleInput;
            aliceSCRAMWitness = result.scramWitness;
            logger.log(`Alice synthetic deposit built.`);

            // Seed Alice's deposit root into the contract's rolling window
            // via the admin-gated adminSetDepositRoot method, so the
            // deposit-root assertion in noriMint() passes.
            const aliceRoot = getContractDepositSlotRootFromContractDepositAndWitness(aliceDepositAttestationInput);
            await txSend({
                body: async () => {
                    await noriTokenBridge.adminSetDepositRoot(aliceRoot, Field(0));
                },
                sender: admin.publicKey,
                signers: [admin.privateKey],
            });
            await fetchAccount({ publicKey: noriTokenBridgeKeypair.publicKey });
            logger.log('Deposit root seeded into contract window for Alice.');
        }, 1_000_000);

        describe('Happy Path', () => {
            test('should mint 2 bridge units for Alice on first deposit', async () => {
                await txSend({
                    body: async () => {
                        AccountUpdate.fundNewAccount(alice.publicKey, 1);
                        await noriTokenBridge.noriMint(aliceDepositAttestationInput, aliceSCRAMWitness);
                    },
                    sender: alice.publicKey,
                    signers: [alice.privateKey],
                });

                await fetchAccount({
                    publicKey: alice.publicKey,
                    tokenId: tokenBase.deriveTokenId(),
                });

                const balance = await tokenBase.getBalanceOf(alice.publicKey);
                assert.equal(balance.toBigInt(), 200n, 'Alice should hold 200 bridge units');

                const storage = new NoriStorageInterface(
                    alice.publicKey,
                    noriTokenBridge.deriveTokenId()
                );
                const mintedSoFar = await storage.mintedSoFar.fetch();
                assert.equal(mintedSoFar.toBigInt(), 200n, 'mintedSoFar should record 200 bridge units');

                logger.log(`Alice minted ${balance} bridge units successfully.`);
            }, 1_000_000);

            test('should mint 3 additional bridge units for Alice on second deposit (totalLocked=5)', async () => {
                // Build a new synthetic deposit with a higher cumulative totalLocked.
                // Same SCRAM key+message → same codeChallenge, but different value → different root.
                const { merkleInput: aliceDeposit2, scramWitness: aliceSCRAM2 } = buildSyntheticDeposit(
                    alice.privateKey,
                    aliceScramMsg,
                    500n
                );

                // Seed the new deposit root into the window
                const aliceRoot2 = getContractDepositSlotRootFromContractDepositAndWitness(aliceDeposit2);
                await txSend({
                    body: async () => {
                        await noriTokenBridge.adminSetDepositRoot(aliceRoot2, Field(0));
                    },
                    sender: admin.publicKey,
                    signers: [admin.privateKey],
                });
                await fetchAccount({ publicKey: noriTokenBridgeKeypair.publicKey });

                // Mint — contract computes amountToMint = totalLocked(500) - mintedSoFar(200) = 300
                await txSend({
                    body: async () => {
                        await noriTokenBridge.noriMint(aliceDeposit2, aliceSCRAM2);
                    },
                    sender: alice.publicKey,
                    signers: [alice.privateKey],
                });

                await fetchAccount({
                    publicKey: alice.publicKey,
                    tokenId: tokenBase.deriveTokenId(),
                });

                const balance = await tokenBase.getBalanceOf(alice.publicKey);
                assert.equal(balance.toBigInt(), 500n, 'Alice should hold 500 bridge units after second mint');

                const storage = new NoriStorageInterface(
                    alice.publicKey,
                    noriTokenBridge.deriveTokenId()
                );
                const mintedSoFar = await storage.mintedSoFar.fetch();
                assert.equal(mintedSoFar.toBigInt(), 500n, 'mintedSoFar should record 500 bridge units');

                logger.log('Alice minted 300 additional bridge units (total=500).');
            }, 1_000_000);
        });

        // =================================================================
        // Window rotation — 40 roots, eviction after 32
        // =================================================================
        describe('Window Rotation', () => {
            test('window rotation: setup dave and seed prior roots', async () => {
                // Reconstruct the 6 roots already dispatched by prior tests.
                // 4 from update():
                allDispatchedRoots.push(bytes32LEToFieldProvable(ethInput1.verifiedContractDepositsRoot.bytes));
                // allDispatchedRoots.push(bytes32LEToFieldProvable(ethInput2.verifiedContractDepositsRoot.bytes));
                // allDispatchedRoots.push(bytes32LEToFieldProvable(ethInput3.verifiedContractDepositsRoot.bytes));
                // allDispatchedRoots.push(bytes32LEToFieldProvable(ethInput4.verifiedContractDepositsRoot.bytes));
                // 1 from alice first deposit root seed:
                const aliceResult1 = buildSyntheticDeposit(alice.privateKey, 'NoriZK', 200n);
                allDispatchedRoots.push(
                    getContractDepositSlotRootFromContractDepositAndWitness(aliceResult1.merkleInput)
                );
                // 1 from alice second deposit root seed:
                const aliceResult2 = buildSyntheticDeposit(alice.privateKey, 'NoriZK', 500n);
                allDispatchedRoots.push(
                    getContractDepositSlotRootFromContractDepositAndWitness(aliceResult2.merkleInput)
                );

                // Create dave and set up storage
                await txSend({
                    body: async () => {
                        AccountUpdate.fundNewAccount(dave.publicKey, 1);
                        await noriTokenBridge.setUpStorage(dave.publicKey, storageInterfaceVK);
                    },
                    sender: dave.publicKey,
                    signers: [dave.privateKey],
                });
                logger.log(`Dave created. ${allDispatchedRoots.length} prior roots tracked.`);
            }, 1_000_000);

            // Dispatch 40 roots. Mint for Dave after roots #5, #15, #25, #35.
            // Roots #1-26 fill the remaining window (6 already in).
            // Root #27+ triggers eviction (window size = 32).
            for (let i = 1; i <= 40; i++) {
                const shouldMint = [5, 15, 25, 35, 40].includes(i);

                if (shouldMint) {
                    test(`window rotation root #${i}: dispatch + mint for Dave`, async () => {
                        daveTotalLocked += 100n;

                        const { merkleInput, scramWitness } = buildSyntheticDeposit(
                            dave.privateKey,
                            'NoriZK',
                            daveTotalLocked
                        );
                        const root = getContractDepositSlotRootFromContractDepositAndWitness(merkleInput);

                        // Dispatch this root into the window
                        const windowIsFull = allDispatchedRoots.length >= 32;
                        const oldest = windowIsFull
                            ? allDispatchedRoots[allDispatchedRoots.length - 32]
                            : Field(0);
                        await txSend({
                            body: async () => {
                                await noriTokenBridge.adminSetDepositRoot(root, oldest);
                            },
                            sender: admin.publicKey,
                            signers: [admin.privateKey],
                        });
                        allDispatchedRoots.push(root);
                        await fetchAccount({ publicKey: noriTokenBridgeKeypair.publicKey });

                        // Fund token account on first mint only
                        const isFirstMint = daveMintCount === 0;
                        await txSend({
                            body: async () => {
                                if (isFirstMint) AccountUpdate.fundNewAccount(dave.publicKey, 1);
                                await noriTokenBridge.noriMint(merkleInput, scramWitness);
                            },
                            sender: dave.publicKey,
                            signers: [dave.privateKey],
                        });

                        await fetchAccount({
                            publicKey: dave.publicKey,
                            tokenId: tokenBase.deriveTokenId(),
                        });

                        const balance = await tokenBase.getBalanceOf(dave.publicKey);
                        assert.equal(balance.toBigInt(), daveTotalLocked, `Dave balance should be ${daveTotalLocked}`);

                        const storage = new NoriStorageInterface(dave.publicKey, noriTokenBridge.deriveTokenId());
                        const mintedSoFar = await storage.mintedSoFar.fetch();
                        assert.equal(mintedSoFar.toBigInt(), daveTotalLocked, `Dave mintedSoFar should be ${daveTotalLocked}`);

                        daveMintCount++;
                        logger.log(`Window rotation root #${i}: Dave minted (totalLocked=${daveTotalLocked})`);
                    }, 1_000_000);
                } else {
                    test(`window rotation root #${i}: dispatch deposit root`, async () => {
                        const dummyRoot = Field(1_000_000n + BigInt(i));
                        const windowIsFull = allDispatchedRoots.length >= 32;
                        const oldest = windowIsFull
                            ? allDispatchedRoots[allDispatchedRoots.length - 32]
                            : Field(0);
                        await txSend({
                            body: async () => {
                                await noriTokenBridge.adminSetDepositRoot(dummyRoot, oldest);
                            },
                            sender: admin.publicKey,
                            signers: [admin.privateKey],
                        });
                        allDispatchedRoots.push(dummyRoot);
                        await fetchAccount({ publicKey: noriTokenBridgeKeypair.publicKey });
                        logger.log(`Window rotation root #${i} dispatched (total=${allDispatchedRoots.length}, windowSize=${Math.min(allDispatchedRoots.length, 32)})`);
                    }, 1_000_000);
                }
            }

            test('window should be capped at 32', async () => {
                await fetchAccount({ publicKey: noriTokenBridgeKeypair.publicKey });
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                const windowSize = (await noriTokenBridge.windowSize.fetch())!;
                assert.equal(windowSize.toBigInt(), 32n, 'Window size should be capped at 32');
                logger.log(`Window rotation complete. windowSize=${windowSize}.`);
            }, 1_000_000);
        }); // End Window Rotation

        describe('Negative Tests', () => {
            test('should REJECT double-mint with the same deposit (zero new amount)', async () => {
                await assert.rejects(
                    () =>
                        txSend({
                            body: async () => {
                                await noriTokenBridge.noriMint(aliceDepositAttestationInput, aliceSCRAMWitness);
                            },
                            sender: alice.publicKey,
                            signers: [alice.privateKey],
                        }),
                    'Double-mint with same deposit must fail'
                );
            }, 1_000_000);

            test('should REJECT mint when totalLocked < 1 bridge unit', async () => {
                const bob = PrivateKey.randomKeypair();
                const { merkleInput: bobDepositAttestationInput, scramWitness: bobSCRAMWitness } = buildSyntheticDeposit(
                    bob.privateKey,
                    'NoriZK',
                    0n
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
                                await noriTokenBridge.noriMint(bobDepositAttestationInput, bobSCRAMWitness);
                            },
                            sender: bob.publicKey,
                            signers: [bob.privateKey],
                        }),
                    'Mint with totalLocked < 1 bridge unit must fail'
                );
            }, 1_000_000);

            test('should REJECT mint with wrong SCRAM witness', async () => {
                const wrongKey = PrivateKey.random();
                const { scramWitness: wrongSCRAMWitness } = buildSyntheticDeposit(
                    wrongKey,
                    'NoriZK-Wrong',
                    2n
                );

                await assert.rejects(
                    () =>
                        txSend({
                            body: async () => {
                                await noriTokenBridge.noriMint(aliceDepositAttestationInput, wrongSCRAMWitness);
                            },
                            sender: alice.publicKey,
                            signers: [alice.privateKey],
                        }),
                    'Wrong SCRAM witness must fail'
                );
            }, 1_000_000);

            test('should REJECT mint without storage setup (storage.account.isNew must be false)', async () => {
                const charlie = PrivateKey.randomKeypair();
                const { merkleInput: charlieDepositAttestationInput, scramWitness: charlieSCRAMWitness } = buildSyntheticDeposit(
                    charlie.privateKey,
                    'NoriZK-Charlie',
                    2n
                );

                await assert.rejects(
                    () =>
                        txSend({
                            body: async () => {
                                AccountUpdate.fundNewAccount(charlie.publicKey, 1);
                                await noriTokenBridge.noriMint(charlieDepositAttestationInput, charlieSCRAMWitness);
                            },
                            sender: charlie.publicKey,
                            signers: [charlie.privateKey],
                        }),
                    'Minting without storage setup must fail'
                );
            }, 1_000_000);

            test('should REJECT cross-user SCRAM attack (wrong sender cannot claim Alice deposit)', async () => {
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
                                await noriTokenBridge.noriMint(aliceDepositAttestationInput, aliceSCRAMWitness);
                            },
                            sender: eve.publicKey,
                            signers: [eve.privateKey],
                        }),
                    'Cross-user SCRAM attack must fail'
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
    /*
    describe('Admin operations', () => {
        test('updateStoreHash() should succeed with admin signature', async () => {
            const newBytes = new Array(32).fill(0).map((_, i) => i % 256);
            const newStoreHash = Bytes32FieldPair.fromBytes32(
                Bytes32.from(newBytes)
            );

            await txSend({
                body: async () => {
                    await noriTokenBridge.updateStoreHash(newStoreHash);
                },
                sender: admin.publicKey,
                signers: [admin.privateKey],
            });

            await fetchAccount({ publicKey: noriTokenBridgeKeypair.publicKey });
            const hb =
                await noriTokenBridge.latestHeliusStoreInputHashHighByte.fetch();
            const lb =
                await noriTokenBridge.latestHeliusStoreInputHashLowerBytes.fetch();
            assert.equal(
                hb.toBigInt(),
                newStoreHash.highByteField.toBigInt(),
                'high byte after updateStoreHash'
            );
            assert.equal(
                lb.toBigInt(),
                newStoreHash.lowerBytesField.toBigInt(),
                'lower bytes after updateStoreHash'
            );
        }, 1_000_000);

        test('updateStoreHash() should REJECT without admin signature', async () => {
            const newStoreHash = Bytes32FieldPair.fromBytes32(
                Bytes32.from(new Array(32).fill(99))
            );
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
                            await noriTokenBridge.updateVerificationKey(
                                freshVK
                            );
                        },
                        sender: alice.publicKey,
                        signers: [alice.privateKey],
                    }),
                'updateVerificationKey() without admin must fail'
            );
        }, 1_000_000);
    });
    */
});

