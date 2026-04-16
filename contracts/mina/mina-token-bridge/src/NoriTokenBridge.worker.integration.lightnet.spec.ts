/**
 * NoriTokenBridge Worker-driven E2E Test Suite (Lightnet)
 *
 * Mirrors the happy-path flow from NoriTokenBridge.integration.lightnet.spec.ts
 * but drives all available contract interactions through TokenBridgeDeployerWorker
 * and TokenBridgeWorker. Methods not exposed by the workers
 * (adminSetDepositRoot) fall back to direct contract calls.
 *
 * Requires: Lightnet running at http://localhost:8080/graphql (accountManager at :8181)
 *
 * Test sequence (order-dependent, shared state):
 *   1. Deploy contracts                         (TokenBridgeDeployerWorker.deployContracts)
 *   2. setIntegrityParams (pi0 + po2)           (TokenBridgeDeployerWorker.setIntegrityParams)
 *   3. update() — 4 consecutive blocks          (TokenBridgeWorker.MOCK_update)
 *   4. setUpStorage for Alice                   (TokenBridgeWorker.MOCK_setupStorage)
 *   5. adminSetDepositRoot + noriMint for Alice (direct call + TokenBridgeWorker.MOCK_mint)
 */

import { Logger, LogPrinter } from 'esm-iso-logger';
import {
    fetchAccount,
    Field,
    Mina,
    type NetworkId,
    Poseidon,
    PrivateKey,
    type PublicKey,
} from 'o1js';
import assert from 'node:assert';
import { FungibleToken } from './TokenBase.js';
import { NoriStorageInterface } from './NoriStorageInterface.js';
import { NoriTokenBridge } from './NoriTokenBridge.js';
import {
    type MerkleTreeContractDepositAttestorInput,
    type MerkleTreeContractDepositAttestorInputJson,
    getContractDepositSlotRootFromContractDepositAndWitness,
} from './depositAttestation.js';
import {
    EthInput,
    decodeConsensusMptProof,
    Bytes20,
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
import { TokenBridgeDeployerWorker } from './workers/tokenBridgeDeployer/worker.js';
import { TokenBridgeWorker } from './workers/tokenBridgeWorker/worker.js';

new LogPrinter('TestMinaNoriTokenBridgeWorker');
const logger = new Logger('WorkerIntegrationLightnetTest');

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

let allAccounts: PublicKey[];

// Workers
let deployerWorker: TokenBridgeDeployerWorker;
let bridgeWorker: TokenBridgeWorker;
let aliceBridgeWorker: TokenBridgeWorker;

// Compiled VK (safe form) — produced by deployerWorker.compile()
let storageInterfaceVerificationKeySafe: { hashStr: string; data: string };
let storageInterfaceVKHashField: Field;

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
describe('NoriTokenBridge (Worker-driven)', () => {
    beforeAll(async () => {
        const networkOptions = {
            networkId: 'testnet' as NetworkId,
            mina:
                process.env.MINA_RPC_NETWORK_URL ??
                'http://localhost:8080/graphql',
            archive:
                process.env.MINA_ARCHIVE_RPC_URL ??
                'http://localhost:8282',
        };

        // Configure workers (also sets active Mina instance globally).
        deployerWorker = new TokenBridgeDeployerWorker();
        await deployerWorker.minaSetup(networkOptions);

        bridgeWorker = new TokenBridgeWorker();
        await bridgeWorker.minaSetup(networkOptions);

        aliceBridgeWorker = new TokenBridgeWorker();
        await aliceBridgeWorker.minaSetup(networkOptions);

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
        storageInterfaceVKHashField = new Field(
            BigInt(storageInterfaceVerificationKeySafe.hashStr)
        );
        await bridgeWorker.compileAll()
        await aliceBridgeWorker.compileAll()

        // Bind deployer's bridge worker (used for MOCK_update sign+send paths).
        await bridgeWorker.WALLET_setMinaPrivateKey(
            deployer.privateKey.toBase58()
        );

        // Bind alice's bridge worker to her key for MOCK_* sign+send paths.
        await aliceBridgeWorker.WALLET_setMinaPrivateKey(
            alice.privateKey.toBase58()
        );

        // Decode example proofs (only EthInput needed locally for assertions —
        // raw proof data is forwarded to MOCK_update in JSON form).
        logger.log('Decoding test example proofs...');

        ethInput1 = new EthInput(decodeConsensusMptProof(examples[0].sp1PlonkProof));
        ethInput2 = new EthInput(decodeConsensusMptProof(examples[1].sp1PlonkProof));
        ethInput3 = new EthInput(decodeConsensusMptProof(examples[2].sp1PlonkProof));
        ethInput4 = new EthInput(decodeConsensusMptProof(examples[3].sp1PlonkProof));
        logger.log('All example proofs decoded.');
    }, 1_000_000);

    beforeEach(async () => {
        await fetchAccounts(allAccounts);
    });

    // =======================================================================
    // 1. Deployment via TokenBridgeDeployerWorker
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

            await fetchAccount({
                publicKey: noriTokenBridgeKeypair.publicKey,
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
    // 2. setIntegrityParams (pi0 + po2) via TokenBridgeDeployerWorker
    // =======================================================================
    describe('setIntegrityParams() via worker', () => {
        test('should set pi0 + po2 in a single transaction', async () => {
            const pi0 = FrC.from(bridgeHeadNoriSP1HeliosProgramPi0);
            const po2 = Field.from(proofConversionSP1ToPlonkPO2);

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

            const onchainPo2 = await noriTokenBridge.proofConversionPO2.fetch();
            assert.equal(
                onchainPo2.toBigInt(),
                po2.toBigInt(),
                'proofConversionPO2 mismatch'
            );

            logger.log('Integrity params set via worker.');
        }, 1_000_000);
    });

    // =======================================================================
    // 3. update() — 4 consecutive blocks via TokenBridgeWorker.MOCK_update
    // =======================================================================
    describe('update() via worker', () => {
        test('block 1', async () => {
            await bridgeWorker.MOCK_update(
                noriTokenBridgeKeypair.publicKey.toBase58(),
                examples[0].sp1PlonkProof,
                examples[0].conversionOutputProof.proofData,
                '0',
                fee
            );

            await fetchAccount({
                publicKey: noriTokenBridgeKeypair.publicKey,
            });
            const head = await noriTokenBridge.latestHead.fetch();
            assert.equal(
                head.toBigInt(),
                ethInput1.outputSlot.toBigInt(),
                'latestHead after block 1'
            );
            logger.log(`latestHead advanced to slot ${head} (block 1)`);
        }, 1_000_000);

        test('block 2', async () => {
            await bridgeWorker.MOCK_update(
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

        test('block 3', async () => {
            await bridgeWorker.MOCK_update(
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

        test('block 4', async () => {
            await bridgeWorker.MOCK_update(
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
    });

    // =======================================================================
    // 4. setUpStorage for Alice via TokenBridgeWorker.MOCK_setupStorage
    // =======================================================================
    describe('setUpStorage() via worker', () => {
        test('should initialise storage for Alice', async () => {
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

            logger.log('Storage initialised for Alice via worker.');
        }, 1_000_000);
    });

    // =======================================================================
    // 5. noriMint for Alice via TokenBridgeWorker.MOCK_mint
    //    (deposit-root seed step uses a direct admin call — no worker method)
    // =======================================================================
    describe('noriMint() via worker', () => {
        test('should seed deposit root then mint 200 bridge units for Alice', async () => {
            const aliceScramMsg = 'NoriZK';
            const totalLockedBU = 200n;

            const { merkleInput, scramWitness } = buildSyntheticDeposit(
                alice.privateKey,
                aliceScramMsg,
                totalLockedBU
            );

            // Seed Alice's deposit root into the contract's rolling window via
            // the admin-gated adminSetDepositRoot method (no worker method).
            const depositRoot =
                getContractDepositSlotRootFromContractDepositAndWitness(
                    merkleInput
                );
            await txSend({
                body: async () => {
                    await noriTokenBridge.adminSetDepositRoot(
                        depositRoot,
                        Field(0)
                    );
                },
                sender: admin.publicKey,
                signers: [admin.privateKey],
            });
            await fetchAccount({
                publicKey: noriTokenBridgeKeypair.publicKey,
            });

            // Mint via the worker. MOCK_mint expects the merkle witness and the
            // SCRAM signature in serialised form (JSON / base58).
            const merkleInputJson = merkleInputToJson(merkleInput);
            const signatureSCRAMBase58 = scramWitness.signature.toBase58();

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
                totalLockedBU,
                `Alice should hold ${totalLockedBU} bridge units`
            );

            const storage = new NoriStorageInterface(
                alice.publicKey,
                noriTokenBridge.deriveTokenId()
            );
            const mintedSoFar = await storage.mintedSoFar.fetch();
            assert.equal(
                mintedSoFar.toBigInt(),
                totalLockedBU,
                `mintedSoFar should record ${totalLockedBU} bridge units`
            );

            logger.log(`Alice minted ${balance} bridge units via worker.`);
        }, 1_000_000);
    });
});
