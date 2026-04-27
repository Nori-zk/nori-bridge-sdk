/**
 * NoriTokenBridge Worker-driven Full E2E Test Suite (Lightnet)
 *
 * Mirrors the full integration spec single-thread/NoriTokenBridge.full.lightnet.integration.spec.ts —
 * happy path, negative tests, and the 40-root window rotation block —
 * but drives every contract interaction through a single TokenBridgeTester
 * instance. Deployment + every subsequent op go through the same worker.
 *
 * Only two tests fall back to a direct txSend because they *intentionally*
 * bypass the normal contract entrypoints:
 *   - direct mintedSoFar appState manipulation
 *   - direct FungibleToken.mint() (bypassing NoriTokenBridge)
 *
 * One tester instance handles every user — senderPrivateKey is passed per
 * call, so there's no per-user worker setup.
 */

import { Logger, LogPrinter } from 'esm-iso-logger';
import {
    AccountUpdate,
    fetchAccount,
    Field,
    Mina,
    type NetworkId,
    Poseidon,
    PrivateKey,
    type PublicKey,
    UInt64,
} from 'o1js';
import assert from 'node:assert';
import { FungibleToken } from '../TokenBase.js';
import { NoriStorageInterface } from '../NoriStorageInterface.js';
import { NoriTokenBridge } from '../NoriTokenBridge.js';
import {
    type MerkleTreeContractDepositAttestorInput,
    type MerkleTreeContractDepositAttestorInputJson,
    getContractDepositSlotRootFromContractDepositAndWitness,
} from '../depositAttestation.js';
import type { SCRAMWitness } from '../scram.js';
import {
    EthInput,
    decodeConsensusMptProof,
    Bytes20,
    Bytes32,
    Bytes32FieldPair,
    bytes32LEToFieldProvable,
    bridgeHeadNoriSP1HeliosProgramPi0,
    proofConversionSP1ToPlonkPO2,
} from '@nori-zk/o1js-zk-utils';
import { FrC } from '@nori-zk/proof-conversion/min';
import { buildExampleProofSeriesCreateArguments } from '../constructExampleProofs.js';
import {
    getNewMinaLiteNetAccountKeyPair,
    keyPairBase58ToKeyPair,
    buildSyntheticDeposit,
} from './testUtils.js';
import { getTokenBridgeTester } from '../workers/tokenBridgeTester/node/parent.js';

new LogPrinter('TestMinaNoriTokenBridgeWorkerFull');
const logger = new Logger('WorkerFullIntegrationLightnetTest');

const fee = Number(process.env.MINA_TX_FEE ?? 0.1) * 1e9;

type Keypair = { publicKey: PublicKey; privateKey: PrivateKey };
type SafeVK = { hashStr: string; data: string };
type TesterInstance = InstanceType<ReturnType<typeof getTokenBridgeTester>>;
type CompileOutput = {
    noriStorageInterfaceVerificationKeySafe: SafeVK;
    fungibleTokenVerificationKeySafe: SafeVK;
    noriTokenBridgeVerificationKeySafe: SafeVK;
};

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

// Single worker drives every contract interaction. Lifecycle:
//   - ensureTester() spawns lazily — safe to call from any hook.
//   - afterEach terminates and clears the liveness flag so the next test gets a
//     fresh instance (o1js leaks memory across proof computations otherwise).
// Tester is non-undefined inside test bodies because beforeEach guarantees it.
let tester: TesterInstance;
let testerAlive = false;
// When set, afterEach skips killTester. Used inside negative-test describes
// where assert.rejects tests don't mutate on-chain state — reusing the worker
// across them avoids a recompile per test. The describe's afterAll resets the
// flag and kills the worker.
let keepWorker = false;

// Compiled VKs (safe form) — produced by tester.compile()
let storageInterfaceVerificationKeySafe: SafeVK;
let tokenBaseVerificationKeySafe: SafeVK;
let storageInterfaceVKHashField: Field;

// Network options — captured so the tester can be spawned again after termination.
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

// Spawn a fresh tester worker: wire Mina network + compile circuits.
async function spawnTester(): Promise<{
    instance: TesterInstance;
    compiled: CompileOutput;
}> {
    const TesterWorker = getTokenBridgeTester();
    const instance = new TesterWorker();
    await instance.minaSetup(networkOptions);
    const compiled = await instance.compile();
    return { instance, compiled };
}

// Idempotent: spawns a tester only if one isn't already live. VK metadata is
// re-captured on every spawn (deterministic — same circuits → same VKs).
async function ensureTester(): Promise<void> {
    if (testerAlive) return;
    const spawned = await spawnTester();
    tester = spawned.instance;
    testerAlive = true;
    storageInterfaceVerificationKeySafe =
        spawned.compiled.noriStorageInterfaceVerificationKeySafe;
    tokenBaseVerificationKeySafe =
        spawned.compiled.fungibleTokenVerificationKeySafe;
    storageInterfaceVKHashField = new Field(
        BigInt(storageInterfaceVerificationKeySafe.hashStr)
    );
}

async function killTester(): Promise<void> {
    if (!testerAlive) return;
    tester.signalTerminate();
    testerAlive = false;
    await new Promise((resolve) => setTimeout(() => resolve(null), 2000));
}

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

// Convert an in-memory MerkleTreeContractDepositAttestorInput into the JSON
// form expected by tester.mint().
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

        await ensureTester();

        // Decode example proofs (EthInput only — NodeProofLeft is reconstructed
        // inside tester.update from examples[i].conversionOutputProof.proofData).
        logger.log('Decoding test example EthInputs...');
        ethInput1 = new EthInput(decodeConsensusMptProof(examples[0].sp1PlonkProof));
        ethInput2 = new EthInput(decodeConsensusMptProof(examples[1].sp1PlonkProof));
        ethInput3 = new EthInput(decodeConsensusMptProof(examples[2].sp1PlonkProof));
        ethInput4 = new EthInput(decodeConsensusMptProof(examples[3].sp1PlonkProof));
        logger.log('Example EthInputs decoded.');
    }, 1_000_000);

    beforeEach(async () => {
        await ensureTester();
        await fetchAccounts(allAccounts);
    });

    afterEach(async () => {
        if (keepWorker) return;
        await killTester();
    });

    // =======================================================================
    // Deployment — via tester
    // =======================================================================
    describe('Deployment', () => {
        test('should deploy NoriTokenBridge and FungibleToken via worker', async () => {
            const inputStoreHashHex = ethInput1.inputStoreHash.toHex();
            const decoded = decodeConsensusMptProof(examples[0].sp1PlonkProof);
            const ethTokenBridgeAddressHex = new Bytes20(
                decoded.contractAddress.bytes
            ).toHex();

            await tester.deployContracts(
                deployer.privateKey.toBase58(),
                admin.publicKey.toBase58(),
                noriTokenBridgeKeypair.privateKey.toBase58(),
                tokenBaseKeypair.privateKey.toBase58(),
                inputStoreHashHex,
                ethTokenBridgeAddressHex,
                storageInterfaceVerificationKeySafe,
                bridgeHeadNoriSP1HeliosProgramPi0,
                proofConversionSP1ToPlonkPO2,
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
    // updateNoriHeliosProgramPi0() / updateProofConversionPO2()
    // Worker exposes single-setter AND combined updateIntegrityParams.
    // =======================================================================
    describe('updateNoriHeliosProgramPi0() / updateProofConversionPO2()', () => {
        describe('Happy Path', () => {
            test('should set noriHeliosProgramPi0 with admin key (worker)', async () => {
                const pi0 = bridgeHeadNoriSP1HeliosProgramPi0;

                await tester.updateNoriHeliosProgramPi0(
                    admin.privateKey.toBase58(),
                    noriTokenBridgeKeypair.publicKey.toBase58(),
                    pi0,
                    fee
                );

                await fetchAccount({
                    publicKey: noriTokenBridgeKeypair.publicKey,
                });
                const onchain =
                    await noriTokenBridge.noriHeliosProgramPi0.fetch();
                FrC.from(onchain).assertEquals(
                    FrC.from(pi0),
                    'noriHeliosProgramPi0 mismatch'
                );

                logger.log('noriHeliosProgramPi0 set successfully.');
            }, 1_000_000);

            test('should set both pi0 and po2 in a single transaction (worker)', async () => {
                const pi0 = bridgeHeadNoriSP1HeliosProgramPi0;
                const po2 = proofConversionSP1ToPlonkPO2;

                await tester.updateIntegrityParams(
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
                    FrC.from(pi0),
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

            test('should set proofConversionPO2 with admin key (worker)', async () => {
                const po2 = proofConversionSP1ToPlonkPO2;

                await tester.updateProofConversionPO2(
                    admin.privateKey.toBase58(),
                    noriTokenBridgeKeypair.publicKey.toBase58(),
                    po2,
                    fee
                );

                await fetchAccount({
                    publicKey: noriTokenBridgeKeypair.publicKey,
                });
                const onchain =
                    await noriTokenBridge.proofConversionPO2.fetch();
                assert.equal(
                    onchain.toString(),
                    po2,
                    'proofConversionPO2 mismatch'
                );

                logger.log('proofConversionPO2 set successfully.');
            }, 1_000_000);
        });

        describe('Negative Tests', () => {
            beforeAll(() => { keepWorker = true; });
            afterAll(async () => {
                keepWorker = false;
                await killTester();
            });

            test('should REJECT updateIntegrityParams by arbitrary user (worker, alice)', async () => {
                const pi0 = bridgeHeadNoriSP1HeliosProgramPi0;
                const po2 = proofConversionSP1ToPlonkPO2;

                await assert.rejects(
                    () =>
                        tester.updateIntegrityParams(
                            alice.privateKey.toBase58(),
                            noriTokenBridgeKeypair.publicKey.toBase58(),
                            pi0,
                            po2,
                            fee
                        ),
                    'updateIntegrityParams by alice must fail'
                );
            }, 1_000_000);

            test('should REJECT updateIntegrityParams by deployer (not admin) (worker)', async () => {
                const pi0 = bridgeHeadNoriSP1HeliosProgramPi0;
                const po2 = proofConversionSP1ToPlonkPO2;

                await assert.rejects(
                    () =>
                        tester.updateIntegrityParams(
                            deployer.privateKey.toBase58(),
                            noriTokenBridgeKeypair.publicKey.toBase58(),
                            pi0,
                            po2,
                            fee
                        ),
                    'updateIntegrityParams by deployer must fail'
                );
            }, 1_000_000);

            test('should REJECT updateNoriHeliosProgramPi0 by arbitrary user (worker)', async () => {
                await assert.rejects(
                    () =>
                        tester.updateNoriHeliosProgramPi0(
                            alice.privateKey.toBase58(),
                            noriTokenBridgeKeypair.publicKey.toBase58(),
                            FrC.from(33).toBigInt().toString(),
                            fee
                        )
                );
            }, 1_000_000);

            test('should REJECT updateProofConversionPO2 by arbitrary user (worker)', async () => {
                await assert.rejects(
                    () =>
                        tester.updateProofConversionPO2(
                            alice.privateKey.toBase58(),
                            noriTokenBridgeKeypair.publicKey.toBase58(),
                            '54',
                            fee
                        )
                );
            }, 1_000_000);

            test('should REJECT updateNoriHeliosProgramPi0 by deployer (not admin) (worker)', async () => {
                await assert.rejects(
                    () =>
                        tester.updateNoriHeliosProgramPi0(
                            deployer.privateKey.toBase58(),
                            noriTokenBridgeKeypair.publicKey.toBase58(),
                            FrC.from(43).toBigInt().toString(),
                            fee
                        )
                );
            }, 1_000_000);

            test('should REJECT updateProofConversionPO2 by deployer (not admin) (worker)', async () => {
                await assert.rejects(
                    () =>
                        tester.updateProofConversionPO2(
                            deployer.privateKey.toBase58(),
                            noriTokenBridgeKeypair.publicKey.toBase58(),
                            '65',
                            fee
                        )
                );
            }, 1_000_000);
        });
    });

    // =======================================================================
    // update() — Ethereum state verification (worker)
    // =======================================================================
    describe('update()', () => {
        describe('Happy Path', () => {
            test('should accept the first SP1 proof and advance latestHead (block 1) (worker)', async () => {
                const headBefore = await noriTokenBridge.latestHead.fetch();

                await tester.update(
                    deployer.privateKey.toBase58(),
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
                await tester.update(
                    deployer.privateKey.toBase58(),
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
                await tester.update(
                    deployer.privateKey.toBase58(),
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
                await tester.update(
                    deployer.privateKey.toBase58(),
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
            beforeAll(() => { keepWorker = true; });
            afterAll(async () => {
                keepWorker = false;
                await killTester();
            });

            test('should REJECT replay of old proof (slot not greater than current) (worker)', async () => {
                await assert.rejects(
                    () =>
                        tester.update(
                            deployer.privateKey.toBase58(),
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
                        tester.update(
                            deployer.privateKey.toBase58(),
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
    });

    // =======================================================================
    // setUpStorage() — Per-user storage initialisation
    // =======================================================================
    describe('setUpStorage()', () => {
        describe('Happy Path', () => {
            test('should initialise storage for Alice (worker)', async () => {
                await tester.setUpStorage(
                    alice.privateKey.toBase58(),
                    alice.privateKey.toBase58(),
                    noriTokenBridgeKeypair.publicKey.toBase58(),
                    storageInterfaceVerificationKeySafe,
                    fee
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
            beforeAll(() => { keepWorker = true; });
            afterAll(async () => {
                keepWorker = false;
                await killTester();
            });

            test('should REJECT duplicate storage setup for Alice (worker)', async () => {
                await assert.rejects(
                    () =>
                        tester.setUpStorage(
                            alice.privateKey.toBase58(),
                            alice.privateKey.toBase58(),
                            noriTokenBridgeKeypair.publicKey.toBase58(),
                            storageInterfaceVerificationKeySafe,
                            fee
                        ),
                    'Duplicate setUpStorage must fail'
                );
            }, 1_000_000);

            test('should REJECT storage setup with wrong VK (hash mismatch) (worker)', async () => {
                const bob = PrivateKey.randomKeypair();
                await assert.rejects(
                    () =>
                        tester.setUpStorage(
                            deployer.privateKey.toBase58(),
                            bob.privateKey.toBase58(),
                            noriTokenBridgeKeypair.publicKey.toBase58(),
                            tokenBaseVerificationKeySafe,
                            fee
                        ),
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
        const allDispatchedRoots: Field[] = [];
        let daveTotalLocked = 0n;
        let daveMintCount = 0;

        beforeAll(async () => {
            await ensureTester();

            dave = keyPairBase58ToKeyPair(
                await getNewMinaLiteNetAccountKeyPair()
            );
            allAccounts.push(dave.publicKey);

            const result = buildSyntheticDeposit(
                alice.privateKey,
                aliceScramMsg,
                200n
            );
            aliceDepositAttestationInput = result.merkleInput;
            aliceSCRAMWitness = result.scramWitness;
            logger.log(`Alice synthetic deposit built.`);
            await fetchAccounts(allAccounts);

            // Seed Alice's deposit root into the contract's rolling window via
            // the admin-gated adminSetDepositRoot method (through the tester worker).
            const aliceRoot =
                getContractDepositSlotRootFromContractDepositAndWitness(
                    aliceDepositAttestationInput
                );
            await tester.adminSetDepositRoot(
                admin.privateKey.toBase58(),
                noriTokenBridgeKeypair.publicKey.toBase58(),
                aliceRoot.toBigInt().toString(),
                '0',
                fee
            );
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

                await tester.mint(
                    alice.privateKey.toBase58(),
                    noriTokenBridgeKeypair.publicKey.toBase58(),
                    merkleInputJson,
                    aliceScramMsg,
                    signatureSCRAMBase58,
                    /* fundNewAccount */ true,
                    fee
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
                const {
                    merkleInput: aliceDeposit2,
                    scramWitness: aliceSCRAM2,
                } = buildSyntheticDeposit(
                    alice.privateKey,
                    aliceScramMsg,
                    500n
                );

                const aliceRoot2 =
                    getContractDepositSlotRootFromContractDepositAndWitness(
                        aliceDeposit2
                    );
                await tester.adminSetDepositRoot(
                    admin.privateKey.toBase58(),
                    noriTokenBridgeKeypair.publicKey.toBase58(),
                    aliceRoot2.toBigInt().toString(),
                    '0',
                    fee
                );
                await fetchAccount({
                    publicKey: noriTokenBridgeKeypair.publicKey,
                });

                // Mint via worker — contract computes amountToMint = 500 - 200 = 300.
                await tester.mint(
                    alice.privateKey.toBase58(),
                    noriTokenBridgeKeypair.publicKey.toBase58(),
                    merkleInputToJson(aliceDeposit2),
                    aliceScramMsg,
                    aliceSCRAM2.signature.toBase58(),
                    /* fundNewAccount */ false,
                    fee
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
                // Reconstruct the roots already dispatched by prior tests.
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

                // Create dave's storage account via the tester worker.
                await tester.setUpStorage(
                    dave.privateKey.toBase58(),
                    dave.privateKey.toBase58(),
                    noriTokenBridgeKeypair.publicKey.toBase58(),
                    storageInterfaceVerificationKeySafe,
                    fee
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

                        // Dispatch this root into the window via the tester worker.
                        const windowIsFull = allDispatchedRoots.length >= 32;
                        const oldest = windowIsFull
                            ? allDispatchedRoots[
                            allDispatchedRoots.length - 32
                            ]
                            : Field(0);
                        await tester.adminSetDepositRoot(
                            admin.privateKey.toBase58(),
                            noriTokenBridgeKeypair.publicKey.toBase58(),
                            root.toBigInt().toString(),
                            oldest.toBigInt().toString(),
                            fee
                        );
                        allDispatchedRoots.push(root);
                        await fetchAccount({
                            publicKey: noriTokenBridgeKeypair.publicKey,
                        });

                        // Fund token account on first mint only.
                        const isFirstMint = daveMintCount === 0;
                        await tester.mint(
                            dave.privateKey.toBase58(),
                            noriTokenBridgeKeypair.publicKey.toBase58(),
                            merkleInputToJson(merkleInput),
                            'NoriZK',
                            scramWitness.signature.toBase58(),
                            /* fundNewAccount */ isFirstMint,
                            fee
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
                    test(`window rotation root #${i}: dispatch deposit root (worker)`, async () => {
                        const dummyRoot = Field(1_000_000n + BigInt(i));
                        const windowIsFull = allDispatchedRoots.length >= 32;
                        const oldest = windowIsFull
                            ? allDispatchedRoots[
                            allDispatchedRoots.length - 32
                            ]
                            : Field(0);
                        await tester.adminSetDepositRoot(
                            admin.privateKey.toBase58(),
                            noriTokenBridgeKeypair.publicKey.toBase58(),
                            dummyRoot.toBigInt().toString(),
                            oldest.toBigInt().toString(),
                            fee
                        );
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
            beforeAll(() => { keepWorker = true; });
            afterAll(async () => {
                keepWorker = false;
                await killTester();
            });

            test('should REJECT double-mint with the same deposit (worker)', async () => {
                await assert.rejects(
                    () =>
                        tester.mint(
                            alice.privateKey.toBase58(),
                            noriTokenBridgeKeypair.publicKey.toBase58(),
                            merkleInputToJson(aliceDepositAttestationInput),
                            aliceScramMsg,
                            aliceSCRAMWitness.signature.toBase58(),
                            /* fundNewAccount */ false,
                            fee
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

                // Set up bob's storage via the tester worker (deployer funds, bob signs).
                await tester.setUpStorage(
                    deployer.privateKey.toBase58(),
                    bob.privateKey.toBase58(),
                    noriTokenBridgeKeypair.publicKey.toBase58(),
                    storageInterfaceVerificationKeySafe,
                    fee
                );

                await assert.rejects(
                    () =>
                        tester.mint(
                            bob.privateKey.toBase58(),
                            noriTokenBridgeKeypair.publicKey.toBase58(),
                            merkleInputToJson(bobDepositAttestationInput),
                            'NoriZK',
                            bobSCRAMWitness.signature.toBase58(),
                            /* fundNewAccount */ true,
                            fee
                        ),
                    'Mint with totalLocked < 1 bridge unit must fail'
                );
            }, 1_000_000);

            test('should REJECT mint with wrong SCRAM witness (worker)', async () => {
                const wrongKey = PrivateKey.random();
                const { scramWitness: wrongSCRAMWitness } =
                    buildSyntheticDeposit(wrongKey, 'NoriZK-Wrong', 2n);

                await assert.rejects(
                    () =>
                        tester.mint(
                            alice.privateKey.toBase58(),
                            noriTokenBridgeKeypair.publicKey.toBase58(),
                            merkleInputToJson(aliceDepositAttestationInput),
                            'NoriZK-Wrong',
                            wrongSCRAMWitness.signature.toBase58(),
                            /* fundNewAccount */ false,
                            fee
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

                await assert.rejects(
                    () =>
                        tester.mint(
                            charlie.privateKey.toBase58(),
                            noriTokenBridgeKeypair.publicKey.toBase58(),
                            merkleInputToJson(charlieDepositAttestationInput),
                            'NoriZK-Charlie',
                            charlieSCRAMWitness.signature.toBase58(),
                            /* fundNewAccount */ true,
                            fee
                        ),
                    'Minting without storage setup must fail'
                );
            }, 1_000_000);

            test('should REJECT cross-user SCRAM attack (worker, eve cannot claim alice deposit)', async () => {
                const eve = PrivateKey.randomKeypair();

                // Set up eve's storage via the tester worker (deployer funds, eve signs).
                await tester.setUpStorage(
                    deployer.privateKey.toBase58(),
                    eve.privateKey.toBase58(),
                    noriTokenBridgeKeypair.publicKey.toBase58(),
                    storageInterfaceVerificationKeySafe,
                    fee
                );

                await assert.rejects(
                    () =>
                        tester.mint(
                            eve.privateKey.toBase58(),
                            noriTokenBridgeKeypair.publicKey.toBase58(),
                            merkleInputToJson(aliceDepositAttestationInput),
                            aliceScramMsg,
                            aliceSCRAMWitness.signature.toBase58(),
                            /* fundNewAccount */ true,
                            fee
                        ),
                    'Cross-user SCRAM attack must fail'
                );
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
    });
});