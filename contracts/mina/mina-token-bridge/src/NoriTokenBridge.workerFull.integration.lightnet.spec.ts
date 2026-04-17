/**
 * NoriTokenBridge Worker-driven Full E2E Test Suite (Lightnet)
 *
 * Mirrors the full integration spec NoriTokenBridge.integration.lightnet.spec.ts —
 * happy path, negative tests, and the 40-root window rotation block —
 * but drives every contract interaction through TokenBridgeDeployerWorker /
 * TokenBridgeWorker where a worker method exists. Methods not exposed by
 * any worker (adminSetDepositRoot, single-setter for pi0/po2,
 * direct mintedSoFar manipulation, direct FungibleToken.mint) fall back
 * to direct contract calls.
 *
 * Each user that needs MOCK_setupStorage / MOCK_mint gets its own
 * TokenBridgeWorker instance, because WALLET_setMinaPrivateKey is one-shot.
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
} from 'o1js';
import { type VerificationKey } from 'o1js';
import assert from 'node:assert';
import { FungibleToken } from './TokenBase.js';
import { NoriStorageInterface } from './NoriStorageInterface.js';
import { NoriTokenBridge } from './NoriTokenBridge.js';
import {
    type MerkleTreeContractDepositAttestorInput,
    type MerkleTreeContractDepositAttestorInputJson,
    getContractDepositSlotRootFromContractDepositAndWitness,
} from './depositAttestation.js';
import type { SCRAMWitness } from './scram.js';
import {
    EthInput,
    decodeConsensusMptProof,
    Bytes20,
    Bytes32,
    Bytes32FieldPair,
    bytes32LEToFieldProvable,
    bridgeHeadNoriSP1HeliosProgramPi0,
    proofConversionSP1ToPlonkPO2,
} from '@nori-zk/o1js-zk-utils-new';
import { FrC } from '@nori-zk/proof-conversion/min';
import { buildExampleProofSeriesCreateArguments } from './constructExampleProofs.js';
import {
    getNewMinaLiteNetAccountKeyPair,
    keyPairBase58ToKeyPair,
    buildSyntheticDeposit,
} from './testUtils.js';
import { getTokenBridgeDeployerWorker } from './workers/tokenBridgeDeployer/node/parent.js';
import { getTokenBridgeWorker } from './workers/tokenBridgeWorker/node/parent.js';

new LogPrinter('TestMinaNoriTokenBridgeWorkerFull');
const logger = new Logger('WorkerFullIntegrationLightnetTest');

const fee = Number(process.env.MINA_TX_FEE ?? 0.1) * 1e9;

type Keypair = { publicKey: PublicKey; privateKey: PrivateKey };
type SafeVK = { hashStr: string; data: string };

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

let allAccounts: PublicKey[];

// Workers
let deployerWorker: InstanceType<ReturnType<typeof getTokenBridgeDeployerWorker>>;
let aliceBridgeWorker: InstanceType<ReturnType<typeof getTokenBridgeWorker>>;
let deployerBridgeWorker: InstanceType<ReturnType<typeof getTokenBridgeWorker>>;

// Compiled VKs (safe form) — produced by deployerWorker.compile()
let storageInterfaceVerificationKeySafe: SafeVK;
let tokenBaseVerificationKeySafe: SafeVK;
let storageInterfaceVKHashField: Field;

// Reconstructed VKs (for direct contract calls that need a VerificationKey)
let storageInterfaceVK: VerificationKey;
let tokenBaseVK: VerificationKey;

// Network options — captured so per-user workers can reuse the same setup.
let networkOptions: {
    networkId: NetworkId;
    mina: string;
    archive: string;
};

const examples = buildExampleProofSeriesCreateArguments();
let ethInput1: EthInput;
let ethInput2: EthInput;
let ethInput3: EthInput;
let ethInput4: EthInput;

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

// Build a fresh TokenBridgeWorker bound to the given Mina key.
// WALLET_setMinaPrivateKey is one-shot per worker instance, so any user
// that needs MOCK_setupStorage / MOCK_mint requires its own worker.
async function makeBridgeWorker(
    pk: PrivateKey
): Promise<InstanceType<ReturnType<typeof getTokenBridgeWorker>>> {
    const BridgeWorker = getTokenBridgeWorker();
    const w = new BridgeWorker();
    await w.minaSetup(networkOptions);
    await w.compileAll();
    await w.WALLET_setMinaPrivateKey(pk.toBase58());
    return w;
}

// Reconstruct an o1js VerificationKey from the safe (serialisable) form.
function vkFromSafe(safe: SafeVK): VerificationKey {
    return {
        data: safe.data,
        hash: new Field(BigInt(safe.hashStr)),
    } as unknown as VerificationKey;
}

// Convert an in-memory MerkleTreeContractDepositAttestorInput into the JSON
// form expected by TokenBridgeWorker.MOCK_mint().
function merkleInputToJson(
    input: MerkleTreeContractDepositAttestorInput
): MerkleTreeContractDepositAttestorInputJson {
    const len = Number(input.path.length.toBigInt());
    const path = input.path.array
        .slice(0, len)
        .map((f) => f.toBigInt().toString());
    return {
        depositIndex: Number(input.index.toBigInt()),
        despositSlotRaw: {
            slot_key_code_challenge: '0x' + input.value.codeChallenge.toHex(),
            value: '0x' + input.value.value.toHex(),
        },
        path,
    };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe('NoriTokenBridge (Worker-driven, full)', () => {
    beforeAll(async () => {
        networkOptions = {
            networkId: 'testnet' as NetworkId,
            mina:
                process.env.MINA_RPC_NETWORK_URL ??
                'http://localhost:8080/graphql',
            archive:
                process.env.MINA_ARCHIVE_RPC_URL ??
                'http://localhost:8282',
        };

        const Network = Mina.Network(networkOptions);
        Mina.setActiveInstance(Network);

        const DeployerWorker = getTokenBridgeDeployerWorker();
        deployerWorker = new DeployerWorker();
        await deployerWorker.minaSetup(networkOptions);

        deployer = keyPairBase58ToKeyPair(
            await getNewMinaLiteNetAccountKeyPair()
        );
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

        // Compile 
        const compiled = await deployerWorker.compile();
        storageInterfaceVerificationKeySafe =
            compiled.noriStorageInterfaceVerificationKeySafe;
        tokenBaseVerificationKeySafe =
            compiled.fungibleTokenVerificationKeySafe;
        storageInterfaceVKHashField = new Field(
            BigInt(storageInterfaceVerificationKeySafe.hashStr)
        );
        storageInterfaceVK = vkFromSafe(storageInterfaceVerificationKeySafe);
        tokenBaseVK = vkFromSafe(tokenBaseVerificationKeySafe);

        // Alice's worker is the one used most often — set it up here.
        aliceBridgeWorker = await makeBridgeWorker(alice.privateKey);
        // Deployer's worker drives update() (relayer-style sender).
        deployerBridgeWorker = await makeBridgeWorker(deployer.privateKey);

        // Decode example proofs (EthInput only — NodeProofLeft is reconstructed
        // inside MOCK_update from examples[i].conversionOutputProof.proofData).
        logger.log('Decoding test example EthInputs...');
        ethInput1 = new EthInput(decodeConsensusMptProof(examples[0].sp1PlonkProof));
        ethInput2 = new EthInput(decodeConsensusMptProof(examples[1].sp1PlonkProof));
        ethInput3 = new EthInput(decodeConsensusMptProof(examples[2].sp1PlonkProof));
        ethInput4 = new EthInput(decodeConsensusMptProof(examples[3].sp1PlonkProof));
        logger.log('Example EthInputs decoded.');
    }, 1_000_000);

    beforeEach(async () => {
        await fetchAccounts(allAccounts);
    });

    // =======================================================================
    // Deployment — via TokenBridgeDeployerWorker
    // =======================================================================
    describe('Deployment', () => {
        test('should deploy NoriTokenBridge and FungibleToken via worker', async () => {
            const inputStoreHashHex = ethInput1.inputStoreHash.toHex();
            const decoded = decodeConsensusMptProof(examples[0].sp1PlonkProof);
            const ethTokenBridgeAddressHex = new Bytes20(
                decoded.contractAddress.bytes
            ).toHex();

            await deployerWorker.deployContracts(
                deployer.privateKey.toBase58(),
                admin.publicKey.toBase58(),
                noriTokenBridgeKeypair.privateKey.toBase58(),
                tokenBaseKeypair.privateKey.toBase58(),
                inputStoreHashHex,
                ethTokenBridgeAddressHex,
                storageInterfaceVerificationKeySafe,
                fee,
                {
                    symbol: 'nETH',
                    decimals: 6,
                    allowUpdates: true,
                    startPaused: false,
                }
            );

            await fetchAccount({ publicKey: noriTokenBridgeKeypair.publicKey });

            const initialStoreHash = Bytes32FieldPair.fromBytes32(
                ethInput1.inputStoreHash
            );

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
                storageInterfaceVKHashField.toBigInt(),
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

            await fetchAccount({ publicKey: tokenBaseKeypair.publicKey });
            const onchainDecimals = await tokenBase.decimals.fetch();
            assert.equal(
                onchainDecimals.toBigInt(),
                6n,
                'token decimals mismatch'
            );

            logger.log('Worker-driven deployment verified.');
        }, 1_000_000);
    });

    // =======================================================================
    // setNoriHeliosProgramPi0() / setProofConversionPO2()
    // Worker exposes only the combined setIntegrityParams — single-setter
    // happy/negative cases use direct calls.
    // =======================================================================
    describe('setNoriHeliosProgramPi0() / setProofConversionPO2()', () => {
        describe('Happy Path', () => {
            test('should set noriHeliosProgramPi0 with admin key (direct)', async () => {
                const pi0 = FrC.from(bridgeHeadNoriSP1HeliosProgramPi0);

                await txSend({
                    body: async () => {
                        await noriTokenBridge.setNoriHeliosProgramPi0(pi0);
                    },
                    sender: admin.publicKey,
                    signers: [admin.privateKey],
                });

                await fetchAccount({
                    publicKey: noriTokenBridgeKeypair.publicKey,
                });
                const onchain =
                    await noriTokenBridge.noriHeliosProgramPi0.fetch();
                FrC.from(onchain).assertEquals(
                    pi0,
                    'noriHeliosProgramPi0 mismatch'
                );

                logger.log('noriHeliosProgramPi0 set successfully.');
            }, 1_000_000);

            test('should set both pi0 and po2 in a single transaction (worker)', async () => {
                const pi0 = bridgeHeadNoriSP1HeliosProgramPi0;
                const po2 = proofConversionSP1ToPlonkPO2;

                await deployerWorker.setIntegrityParams(
                    admin.privateKey.toBase58(),
                    noriTokenBridgeKeypair.publicKey.toBase58(),
                    pi0,
                    po2,
                    fee
                );

                await fetchAccount({
                    publicKey: noriTokenBridgeKeypair.publicKey,
                });

                const onchainPi0 =
                    await noriTokenBridge.noriHeliosProgramPi0.fetch();
                FrC.from(onchainPi0).assertEquals(
                    pi0,
                    'noriHeliosProgramPi0 mismatch'
                );

                const onchainPo2 =
                    await noriTokenBridge.proofConversionPO2.fetch();
                assert.equal(
                    onchainPo2.toString(),
                    po2,
                    'proofConversionPO2 mismatch'
                );

                logger.log('Both pi0 and po2 set via worker.');
            }, 1_000_000);

            test('should set proofConversionPO2 with admin key (direct)', async () => {
                const po2 = Field.from(proofConversionSP1ToPlonkPO2);

                await txSend({
                    body: async () => {
                        await noriTokenBridge.setProofConversionPO2(po2);
                    },
                    sender: admin.publicKey,
                    signers: [admin.privateKey],
                });

                await fetchAccount({
                    publicKey: noriTokenBridgeKeypair.publicKey,
                });
                const onchain =
                    await noriTokenBridge.proofConversionPO2.fetch();
                assert.equal(
                    onchain.toBigInt(),
                    po2.toBigInt(),
                    'proofConversionPO2 mismatch'
                );

                logger.log('proofConversionPO2 set successfully.');
            }, 1_000_000);
        });

        describe('Negative Tests', () => {
            test('should REJECT setIntegrityParams by arbitrary user (worker, alice)', async () => {
                const pi0 = bridgeHeadNoriSP1HeliosProgramPi0;
                const po2 = proofConversionSP1ToPlonkPO2;

                await assert.rejects(
                    () =>
                        deployerWorker.setIntegrityParams(
                            alice.privateKey.toBase58(),
                            noriTokenBridgeKeypair.publicKey.toBase58(),
                            pi0,
                            po2,
                            fee
                        ),
                    'setIntegrityParams by alice must fail'
                );
            }, 1_000_000);

            test('should REJECT setIntegrityParams by deployer (not admin) (worker)', async () => {
                const pi0 = bridgeHeadNoriSP1HeliosProgramPi0;
                const po2 = proofConversionSP1ToPlonkPO2;

                await assert.rejects(
                    () =>
                        deployerWorker.setIntegrityParams(
                            deployer.privateKey.toBase58(),
                            noriTokenBridgeKeypair.publicKey.toBase58(),
                            pi0,
                            po2,
                            fee
                        ),
                    'setIntegrityParams by deployer must fail'
                );
            }, 1_000_000);

            test('should REJECT setNoriHeliosProgramPi0 by arbitrary user (direct)', async () => {
                const pi0 = FrC.from(33);

                await assert.rejects(() =>
                    txSend({
                        body: async () => {
                            await noriTokenBridge.setNoriHeliosProgramPi0(pi0);
                        },
                        sender: alice.publicKey,
                        signers: [alice.privateKey],
                    })
                );
            }, 1_000_000);

            test('should REJECT setProofConversionPO2 by arbitrary user (direct)', async () => {
                const po2 = Field.from(54);

                await assert.rejects(() =>
                    txSend({
                        body: async () => {
                            await noriTokenBridge.setProofConversionPO2(po2);
                        },
                        sender: alice.publicKey,
                        signers: [alice.privateKey],
                    })
                );
            }, 1_000_000);

            test('should REJECT setNoriHeliosProgramPi0 by deployer (not admin) (direct)', async () => {
                const pi0 = FrC.from(43);

                await assert.rejects(() =>
                    txSend({
                        body: async () => {
                            await noriTokenBridge.setNoriHeliosProgramPi0(pi0);
                        },
                        sender: deployer.publicKey,
                        signers: [deployer.privateKey],
                    })
                );
            }, 1_000_000);

            test('should REJECT setProofConversionPO2 by deployer (not admin) (direct)', async () => {
                const po2 = Field.from(65);

                await assert.rejects(() =>
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

        afterAll(() => {
            deployerWorker.signalTerminate();
        });
    });

    // =======================================================================
    // update() — Ethereum state verification (worker)
    // =======================================================================
    describe('update()', () => {
        describe('Happy Path', () => {
            test('should accept the first SP1 proof and advance latestHead (block 1) (worker)', async () => {
                const headBefore = await noriTokenBridge.latestHead.fetch();

                await deployerBridgeWorker.MOCK_update(
                    noriTokenBridgeKeypair.publicKey.toBase58(),
                    examples[0].sp1PlonkProof,
                    examples[0].conversionOutputProof.proofData,
                    '0',
                    fee
                );

                await fetchAccount({
                    publicKey: noriTokenBridgeKeypair.publicKey,
                });

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

            test('should accept block 2 (consecutive from block 1) (worker)', async () => {
                await deployerBridgeWorker.MOCK_update(
                    noriTokenBridgeKeypair.publicKey.toBase58(),
                    examples[1].sp1PlonkProof,
                    examples[1].conversionOutputProof.proofData,
                    '0',
                    fee
                );

                await fetchAccount({
                    publicKey: noriTokenBridgeKeypair.publicKey,
                });
                const head = await noriTokenBridge.latestHead.fetch();
                assert.equal(
                    head.toBigInt(),
                    ethInput2.outputSlot.toBigInt(),
                    'latestHead after block 2'
                );
                logger.log(`latestHead advanced to slot ${head} (block 2)`);
            }, 1_000_000);

            test('should accept block 3 (consecutive from block 2) (worker)', async () => {
                await deployerBridgeWorker.MOCK_update(
                    noriTokenBridgeKeypair.publicKey.toBase58(),
                    examples[2].sp1PlonkProof,
                    examples[2].conversionOutputProof.proofData,
                    '0',
                    fee
                );

                await fetchAccount({
                    publicKey: noriTokenBridgeKeypair.publicKey,
                });
                const head = await noriTokenBridge.latestHead.fetch();
                assert.equal(
                    head.toBigInt(),
                    ethInput3.outputSlot.toBigInt(),
                    'latestHead after block 3'
                );
                logger.log(`latestHead advanced to slot ${head} (block 3)`);
            }, 1_000_000);

            test('should accept block 4 (consecutive from block 3) (worker)', async () => {
                await deployerBridgeWorker.MOCK_update(
                    noriTokenBridgeKeypair.publicKey.toBase58(),
                    examples[3].sp1PlonkProof,
                    examples[3].conversionOutputProof.proofData,
                    '0',
                    fee
                );

                await fetchAccount({
                    publicKey: noriTokenBridgeKeypair.publicKey,
                });
                const head = await noriTokenBridge.latestHead.fetch();
                assert.equal(
                    head.toBigInt(),
                    ethInput4.outputSlot.toBigInt(),
                    'latestHead after block 4'
                );
                logger.log(`latestHead advanced to slot ${head} (block 4)`);
            }, 1_000_000);

            test('verifiedStateRoot should equal Poseidon(executionStateRoot) from last proof', async () => {
                await fetchAccount({
                    publicKey: noriTokenBridgeKeypair.publicKey,
                });
                const onchain =
                    await noriTokenBridge.verifiedStateRoot.fetch();
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
                await fetchAccount({
                    publicKey: noriTokenBridgeKeypair.publicKey,
                });
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
            test('should REJECT replay of old proof (slot not greater than current) (worker)', async () => {
                await assert.rejects(
                    () =>
                        deployerBridgeWorker.MOCK_update(
                            noriTokenBridgeKeypair.publicKey.toBase58(),
                            examples[0].sp1PlonkProof,
                            examples[0].conversionOutputProof.proofData,
                            '0',
                            fee
                        ),
                    'Replay of old proof must fail'
                );
            }, 1_000_000);

            test('should REJECT out-of-order proof (store hash chain broken) (worker)', async () => {
                await assert.rejects(
                    () =>
                        deployerBridgeWorker.MOCK_update(
                            noriTokenBridgeKeypair.publicKey.toBase58(),
                            examples[1].sp1PlonkProof,
                            examples[1].conversionOutputProof.proofData,
                            '0',
                            fee
                        ),
                    'Out-of-order proof (store hash mismatch) must fail'
                );
            }, 1_000_000);
        });

        afterAll(() => {
            deployerBridgeWorker.signalTerminate();
        });
    });

    // =======================================================================
    // setUpStorage() — Per-user storage initialisation
    // =======================================================================
    describe('setUpStorage()', () => {
        describe('Happy Path', () => {
            test('should initialise storage for Alice (worker)', async () => {
                await aliceBridgeWorker.MOCK_setupStorage(
                    alice.publicKey.toBase58(),
                    noriTokenBridgeKeypair.publicKey.toBase58(),
                    fee,
                    storageInterfaceVerificationKeySafe
                );

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
            test('should REJECT duplicate storage setup for Alice (worker)', async () => {
                await assert.rejects(
                    () =>
                        aliceBridgeWorker.MOCK_setupStorage(
                            alice.publicKey.toBase58(),
                            noriTokenBridgeKeypair.publicKey.toBase58(),
                            fee,
                            storageInterfaceVerificationKeySafe
                        ),
                    'Duplicate setUpStorage must fail'
                );
            }, 1_000_000);

            test('should REJECT storage setup with wrong VK (hash mismatch) (direct)', async () => {
                const bob = PrivateKey.randomKeypair();
                await assert.rejects(
                    () =>
                        txSend({
                            body: async () => {
                                AccountUpdate.fundNewAccount(
                                    deployer.publicKey,
                                    1
                                );
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

            test('should REJECT direct mintedSoFar manipulation without a valid proof (direct)', async () => {
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
        let daveBridgeWorker: InstanceType<ReturnType<typeof getTokenBridgeWorker>>;
        const allDispatchedRoots: Field[] = [];
        let daveTotalLocked = 0n;
        let daveMintCount = 0;

        beforeAll(async () => {
            dave = keyPairBase58ToKeyPair(
                await getNewMinaLiteNetAccountKeyPair()
            );
            allAccounts.push(dave.publicKey);
            daveBridgeWorker = await makeBridgeWorker(dave.privateKey);

            const result = buildSyntheticDeposit(
                alice.privateKey,
                aliceScramMsg,
                200n
            );
            aliceDepositAttestationInput = result.merkleInput;
            aliceSCRAMWitness = result.scramWitness;
            logger.log(`Alice synthetic deposit built.`);

            // Seed Alice's deposit root into the contract's rolling window via
            // the admin-gated adminSetDepositRoot method (no worker method).
            const aliceRoot =
                getContractDepositSlotRootFromContractDepositAndWitness(
                    aliceDepositAttestationInput
                );
            await txSend({
                body: async () => {
                    await noriTokenBridge.adminSetDepositRoot(
                        aliceRoot,
                        Field(0)
                    );
                },
                sender: admin.publicKey,
                signers: [admin.privateKey],
            });
            await fetchAccount({
                publicKey: noriTokenBridgeKeypair.publicKey,
            });
            logger.log('Deposit root seeded into contract window for Alice.');
        }, 1_000_000);

        describe('Happy Path', () => {
            test('should mint 2 bridge units for Alice on first deposit (worker)', async () => {
                const merkleInputJson = merkleInputToJson(
                    aliceDepositAttestationInput
                );
                const signatureSCRAMBase58 =
                    aliceSCRAMWitness.signature.toBase58();

                await aliceBridgeWorker.MOCK_mint(
                    alice.publicKey.toBase58(),
                    noriTokenBridgeKeypair.publicKey.toBase58(),
                    merkleInputJson,
                    aliceScramMsg,
                    signatureSCRAMBase58,
                    fee,
                    /* fundNewAccount */ true
                );

                await fetchAccount({
                    publicKey: alice.publicKey,
                    tokenId: tokenBase.deriveTokenId(),
                });

                const balance = await tokenBase.getBalanceOf(alice.publicKey);
                assert.equal(
                    balance.toBigInt(),
                    200n,
                    'Alice should hold 200 bridge units'
                );

                const storage = new NoriStorageInterface(
                    alice.publicKey,
                    noriTokenBridge.deriveTokenId()
                );
                const mintedSoFar = await storage.mintedSoFar.fetch();
                assert.equal(
                    mintedSoFar.toBigInt(),
                    200n,
                    'mintedSoFar should record 200 bridge units'
                );

                logger.log(
                    `Alice minted ${balance} bridge units successfully (worker).`
                );
            }, 1_000_000);

            test('should mint 3 additional bridge units for Alice on second deposit (totalLocked=5) (worker)', async () => {
                // Build a new synthetic deposit with a higher cumulative totalLocked.
                const {
                    merkleInput: aliceDeposit2,
                    scramWitness: aliceSCRAM2,
                } = buildSyntheticDeposit(
                    alice.privateKey,
                    aliceScramMsg,
                    500n
                );

                // Seed the new deposit root into the window (direct admin call).
                const aliceRoot2 =
                    getContractDepositSlotRootFromContractDepositAndWitness(
                        aliceDeposit2
                    );
                await txSend({
                    body: async () => {
                        await noriTokenBridge.adminSetDepositRoot(
                            aliceRoot2,
                            Field(0)
                        );
                    },
                    sender: admin.publicKey,
                    signers: [admin.privateKey],
                });
                await fetchAccount({
                    publicKey: noriTokenBridgeKeypair.publicKey,
                });

                // Mint via worker — contract computes amountToMint = 500 - 200 = 300.
                await aliceBridgeWorker.MOCK_mint(
                    alice.publicKey.toBase58(),
                    noriTokenBridgeKeypair.publicKey.toBase58(),
                    merkleInputToJson(aliceDeposit2),
                    aliceScramMsg,
                    aliceSCRAM2.signature.toBase58(),
                    fee,
                    /* fundNewAccount */ false
                );

                await fetchAccount({
                    publicKey: alice.publicKey,
                    tokenId: tokenBase.deriveTokenId(),
                });

                const balance = await tokenBase.getBalanceOf(alice.publicKey);
                assert.equal(
                    balance.toBigInt(),
                    500n,
                    'Alice should hold 500 bridge units after second mint'
                );

                const storage = new NoriStorageInterface(
                    alice.publicKey,
                    noriTokenBridge.deriveTokenId()
                );
                const mintedSoFar = await storage.mintedSoFar.fetch();
                assert.equal(
                    mintedSoFar.toBigInt(),
                    500n,
                    'mintedSoFar should record 500 bridge units'
                );

                logger.log(
                    'Alice minted 300 additional bridge units (total=500) via worker.'
                );
            }, 1_000_000);
        });

        // =================================================================
        // Window rotation — 40 roots, eviction after 32
        // =================================================================
        describe('Window Rotation', () => {
            test('window rotation: setup dave (worker) and seed prior roots', async () => {
                // Reconstruct the roots already dispatched by prior tests:
                // 1 from update() block 1 (only block 1's root is in the window
                // when adminSetDepositRoot is called; subsequent update() calls
                // also dispatch but the original spec only tracked block 1).
                allDispatchedRoots.push(
                    bytes32LEToFieldProvable(
                        ethInput1.verifiedContractDepositsRoot.bytes
                    )
                );
                // 1 from alice first deposit root seed:
                const aliceResult1 = buildSyntheticDeposit(
                    alice.privateKey,
                    'NoriZK',
                    200n
                );
                allDispatchedRoots.push(
                    getContractDepositSlotRootFromContractDepositAndWitness(
                        aliceResult1.merkleInput
                    )
                );
                // 1 from alice second deposit root seed:
                const aliceResult2 = buildSyntheticDeposit(
                    alice.privateKey,
                    'NoriZK',
                    500n
                );
                allDispatchedRoots.push(
                    getContractDepositSlotRootFromContractDepositAndWitness(
                        aliceResult2.merkleInput
                    )
                );

                // Create dave's storage account via dave's worker.
                await daveBridgeWorker.MOCK_setupStorage(
                    dave.publicKey.toBase58(),
                    noriTokenBridgeKeypair.publicKey.toBase58(),
                    fee,
                    storageInterfaceVerificationKeySafe
                );
                logger.log(
                    `Dave created. ${allDispatchedRoots.length} prior roots tracked.`
                );
            }, 1_000_000);

            // Dispatch 40 roots. Mint for Dave at iterations 5/15/25/35/40.
            for (let i = 1; i <= 40; i++) {
                const shouldMint = [5, 15, 25, 35, 40].includes(i);

                if (shouldMint) {
                    test(`window rotation root #${i}: dispatch + mint for Dave (worker)`, async () => {
                        daveTotalLocked += 100n;

                        const { merkleInput, scramWitness } =
                            buildSyntheticDeposit(
                                dave.privateKey,
                                'NoriZK',
                                daveTotalLocked
                            );
                        const root =
                            getContractDepositSlotRootFromContractDepositAndWitness(
                                merkleInput
                            );

                        // Dispatch this root into the window (direct admin call).
                        const windowIsFull = allDispatchedRoots.length >= 32;
                        const oldest = windowIsFull
                            ? allDispatchedRoots[
                            allDispatchedRoots.length - 32
                            ]
                            : Field(0);
                        await txSend({
                            body: async () => {
                                await noriTokenBridge.adminSetDepositRoot(
                                    root,
                                    oldest
                                );
                            },
                            sender: admin.publicKey,
                            signers: [admin.privateKey],
                        });
                        allDispatchedRoots.push(root);
                        await fetchAccount({
                            publicKey: noriTokenBridgeKeypair.publicKey,
                        });

                        // Fund token account on first mint only.
                        const isFirstMint = daveMintCount === 0;
                        await daveBridgeWorker.MOCK_mint(
                            dave.publicKey.toBase58(),
                            noriTokenBridgeKeypair.publicKey.toBase58(),
                            merkleInputToJson(merkleInput),
                            'NoriZK',
                            scramWitness.signature.toBase58(),
                            fee,
                            /* fundNewAccount */ isFirstMint
                        );

                        await fetchAccount({
                            publicKey: dave.publicKey,
                            tokenId: tokenBase.deriveTokenId(),
                        });

                        const balance = await tokenBase.getBalanceOf(
                            dave.publicKey
                        );
                        assert.equal(
                            balance.toBigInt(),
                            daveTotalLocked,
                            `Dave balance should be ${daveTotalLocked}`
                        );

                        const storage = new NoriStorageInterface(
                            dave.publicKey,
                            noriTokenBridge.deriveTokenId()
                        );
                        const mintedSoFar = await storage.mintedSoFar.fetch();
                        assert.equal(
                            mintedSoFar.toBigInt(),
                            daveTotalLocked,
                            `Dave mintedSoFar should be ${daveTotalLocked}`
                        );

                        daveMintCount++;
                        logger.log(
                            `Window rotation root #${i}: Dave minted (totalLocked=${daveTotalLocked}) via worker`
                        );
                    }, 1_000_000);
                } else {
                    test(`window rotation root #${i}: dispatch deposit root (direct)`, async () => {
                        const dummyRoot = Field(1_000_000n + BigInt(i));
                        const windowIsFull = allDispatchedRoots.length >= 32;
                        const oldest = windowIsFull
                            ? allDispatchedRoots[
                            allDispatchedRoots.length - 32
                            ]
                            : Field(0);
                        await txSend({
                            body: async () => {
                                await noriTokenBridge.adminSetDepositRoot(
                                    dummyRoot,
                                    oldest
                                );
                            },
                            sender: admin.publicKey,
                            signers: [admin.privateKey],
                        });
                        allDispatchedRoots.push(dummyRoot);
                        await fetchAccount({
                            publicKey: noriTokenBridgeKeypair.publicKey,
                        });
                        logger.log(
                            `Window rotation root #${i} dispatched (total=${allDispatchedRoots.length}, windowSize=${Math.min(allDispatchedRoots.length, 32)})`
                        );
                    }, 1_000_000);
                }
            }

            test('window should be capped at 32', async () => {
                await fetchAccount({
                    publicKey: noriTokenBridgeKeypair.publicKey,
                });
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                const windowSize = (await noriTokenBridge.windowSize.fetch())!;
                assert.equal(
                    windowSize.toBigInt(),
                    32n,
                    'Window size should be capped at 32'
                );
                logger.log(
                    `Window rotation complete. windowSize=${windowSize}.`
                );
            }, 1_000_000);
        }); // End Window Rotation

        describe('Negative Tests', () => {
            test('should REJECT double-mint with the same deposit (worker)', async () => {
                await assert.rejects(
                    () =>
                        aliceBridgeWorker.MOCK_mint(
                            alice.publicKey.toBase58(),
                            noriTokenBridgeKeypair.publicKey.toBase58(),
                            merkleInputToJson(aliceDepositAttestationInput),
                            aliceScramMsg,
                            aliceSCRAMWitness.signature.toBase58(),
                            fee,
                            /* fundNewAccount */ false
                        ),
                    'Double-mint with same deposit must fail'
                );
            }, 1_000_000);

            test('should REJECT mint when totalLocked < 1 bridge unit (worker)', async () => {
                const bob = PrivateKey.randomKeypair();
                const {
                    merkleInput: bobDepositAttestationInput,
                    scramWitness: bobSCRAMWitness,
                } = buildSyntheticDeposit(bob.privateKey, 'NoriZK', 0n);

                // Set up bob's storage via direct call (deployer funds + bob signs)
                // because the worker's MOCK_setupStorage uses the user as sender.
                await txSend({
                    body: async () => {
                        AccountUpdate.fundNewAccount(deployer.publicKey, 1);
                        await noriTokenBridge.setUpStorage(
                            bob.publicKey,
                            storageInterfaceVK
                        );
                    },
                    sender: deployer.publicKey,
                    signers: [deployer.privateKey, bob.privateKey],
                });

                const bobBridgeWorker = await makeBridgeWorker(bob.privateKey);

                await assert.rejects(
                    () =>
                        bobBridgeWorker.MOCK_mint(
                            bob.publicKey.toBase58(),
                            noriTokenBridgeKeypair.publicKey.toBase58(),
                            merkleInputToJson(bobDepositAttestationInput),
                            'NoriZK',
                            bobSCRAMWitness.signature.toBase58(),
                            fee,
                            /* fundNewAccount */ true
                        ),
                    'Mint with totalLocked < 1 bridge unit must fail'
                );

                bobBridgeWorker.signalTerminate();
            }, 1_000_000);

            test('should REJECT mint with wrong SCRAM witness (worker)', async () => {
                const wrongKey = PrivateKey.random();
                const { scramWitness: wrongSCRAMWitness } =
                    buildSyntheticDeposit(wrongKey, 'NoriZK-Wrong', 2n);

                await assert.rejects(
                    () =>
                        aliceBridgeWorker.MOCK_mint(
                            alice.publicKey.toBase58(),
                            noriTokenBridgeKeypair.publicKey.toBase58(),
                            merkleInputToJson(aliceDepositAttestationInput),
                            'NoriZK-Wrong',
                            wrongSCRAMWitness.signature.toBase58(),
                            fee,
                            /* fundNewAccount */ false
                        ),
                    'Wrong SCRAM witness must fail'
                );
            }, 1_000_000);

            test('should REJECT mint without storage setup (worker)', async () => {
                const charlie = PrivateKey.randomKeypair();
                allAccounts.push(charlie.publicKey);
                await fetchAccount({ publicKey: charlie.publicKey });

                const {
                    merkleInput: charlieDepositAttestationInput,
                    scramWitness: charlieSCRAMWitness,
                } = buildSyntheticDeposit(
                    charlie.privateKey,
                    'NoriZK-Charlie',
                    2n
                );

                const charlieBridgeWorker = await makeBridgeWorker(
                    charlie.privateKey
                );

                await assert.rejects(
                    () =>
                        charlieBridgeWorker.MOCK_mint(
                            charlie.publicKey.toBase58(),
                            noriTokenBridgeKeypair.publicKey.toBase58(),
                            merkleInputToJson(charlieDepositAttestationInput),
                            'NoriZK-Charlie',
                            charlieSCRAMWitness.signature.toBase58(),
                            fee,
                            /* fundNewAccount */ true
                        ),
                    'Minting without storage setup must fail'
                );

                charlieBridgeWorker.signalTerminate();
            }, 1_000_000);

            test('should REJECT cross-user SCRAM attack (worker, eve cannot claim alice deposit)', async () => {
                const eve = PrivateKey.randomKeypair();

                // Set up eve's storage via direct call.
                await txSend({
                    body: async () => {
                        AccountUpdate.fundNewAccount(deployer.publicKey, 1);
                        await noriTokenBridge.setUpStorage(
                            eve.publicKey,
                            storageInterfaceVK
                        );
                    },
                    sender: deployer.publicKey,
                    signers: [deployer.privateKey, eve.privateKey],
                });

                const eveBridgeWorker = await makeBridgeWorker(eve.privateKey);

                await assert.rejects(
                    () =>
                        eveBridgeWorker.MOCK_mint(
                            eve.publicKey.toBase58(),
                            noriTokenBridgeKeypair.publicKey.toBase58(),
                            merkleInputToJson(aliceDepositAttestationInput),
                            aliceScramMsg,
                            aliceSCRAMWitness.signature.toBase58(),
                            fee,
                            /* fundNewAccount */ true
                        ),
                    'Cross-user SCRAM attack must fail'
                );

                eveBridgeWorker.signalTerminate();
            }, 1_000_000);

            test('should REJECT direct FungibleToken.mint() call (bypassing NoriTokenBridge) (direct)', async () => {
                await assert.rejects(
                    () =>
                        txSend({
                            body: async () => {
                                await tokenBase.mint(
                                    alice.publicKey,
                                    UInt64.from(100)
                                );
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

        afterAll(() => {
            aliceBridgeWorker.signalTerminate();
            daveBridgeWorker.signalTerminate();
        });
    });
});

// keep `Bool` import referenced (some tooling otherwise drops the import).
void Bool;
