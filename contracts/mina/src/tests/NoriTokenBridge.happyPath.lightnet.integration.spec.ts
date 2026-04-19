/**
 * NoriTokenBridge Worker-driven E2E Test Suite (Lightnet)
 *
 * Mirrors the happy-path flow from single-thread/NoriTokenBridge.happyPath.lightnet.integration.spec.ts
 * but drives every contract interaction through a single TokenBridgeTester
 * instance — deployment + every subsequent op go through the same worker.
 *
 * Requires: Lightnet running at http://localhost:8080/graphql (accountManager at :8181)
 *
 * Test sequence (order-dependent, shared state):
 *   1. Deploy contracts                         (tester.deployContracts)
 *   2. update() — 4 consecutive blocks          (tester.update)
 *   3. setUpStorage for Alice                   (tester.setUpStorage)
 *   4. adminSetDepositRoot + noriMint for Alice (tester.adminSetDepositRoot + .mint)
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
import { FungibleToken } from '../TokenBase.js';
import { NoriStorageInterface } from '../NoriStorageInterface.js';
import { NoriTokenBridge } from '../NoriTokenBridge.js';
import {
    type MerkleTreeContractDepositAttestorInput,
    type MerkleTreeContractDepositAttestorInputJson,
    getContractDepositSlotRootFromContractDepositAndWitness,
} from '../depositAttestation.js';
import {
    EthInput,
    decodeConsensusMptProof,
    Bytes20,
    bridgeHeadNoriSP1HeliosProgramPi0,
    proofConversionSP1ToPlonkPO2,
} from '@nori-zk/o1js-zk-utils-new';
import { buildExampleProofSeriesCreateArguments } from '../constructExampleProofs.js';
import {
    getNewMinaLiteNetAccountKeyPair,
    keyPairBase58ToKeyPair,
    buildSyntheticDeposit,
} from './testUtils.js';
import { getTokenBridgeTester } from '../workers/tokenBridgeTester/node/parent.js';

new LogPrinter('TestMinaNoriTokenBridgeWorker');
const logger = new Logger('WorkerIntegrationLightnetTest');

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

// Single worker drives every contract interaction.
let tester: TesterInstance;

// Compiled VK (safe form) — produced by tester.compile()
let storageInterfaceVerificationKeySafe: SafeVK;
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
// Call this whenever you need a new instance (e.g. after signalTerminate()).
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
describe('NoriTokenBridge (Worker-driven)', () => {
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
        const analysis = await NoriTokenBridge.analyzeMethods();
        for (const [name, data] of Object.entries(analysis)) {
            console.log(`${name}: ${data.rows} rows`);
        }

        const spawned = await spawnTester();
        tester = spawned.instance;
        storageInterfaceVerificationKeySafe =
            spawned.compiled.noriStorageInterfaceVerificationKeySafe;
        storageInterfaceVKHashField = new Field(
            BigInt(storageInterfaceVerificationKeySafe.hashStr)
        );

        // Decode example proofs (only EthInput needed locally for assertions —
        // raw proof data is forwarded to tester.update in JSON form).
        logger.log('Decoding test example proofs...');
        ethInput1 = new EthInput(decodeConsensusMptProof(examples[0].sp1PlonkProof));
        ethInput2 = new EthInput(decodeConsensusMptProof(examples[1].sp1PlonkProof));
        ethInput3 = new EthInput(decodeConsensusMptProof(examples[2].sp1PlonkProof));
        ethInput4 = new EthInput(decodeConsensusMptProof(examples[3].sp1PlonkProof));
        logger.log('All example proofs decoded.');
    }, 5_000_000);

    beforeEach(async () => {
        const spawned = await spawnTester();
        tester = spawned.instance;
        logger.warn('Tester worker respawned after termination signal. New instance ready for next test.');
        await fetchAccounts(allAccounts);

    });

    afterEach(async () => {
        tester.signalTerminate();
        await new Promise((resolve) => setTimeout(() => resolve(null), 5000));
    });

    // =======================================================================
    // 1. Deployment via tester
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
        }, 5_000_000);
    });

    // =======================================================================
    // 2. update() — 4 consecutive blocks via tester
    // =======================================================================
    describe('update() via tester worker', () => {

        test('block 1', async () => {
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
            const head = await noriTokenBridge.latestHead.fetch();
            assert.equal(
                head.toBigInt(),
                ethInput1.outputSlot.toBigInt(),
                'latestHead after block 1'
            );
            logger.log(`latestHead advanced to slot ${head} (block 1)`);
        }, 5_000_000);

        test('block 2', async () => {
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
        }, 5_000_000);

        test('block 3', async () => {
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
        }, 5_000_000);

        test('block 4', async () => {
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
        }, 5_000_000);
    });

    // =======================================================================
    // 3. setUpStorage for Alice via tester
    // =======================================================================
    describe('setUpStorage() via tester worker', () => {
        test('should initialise storage for Alice', async () => {
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

            logger.log('Storage initialised for Alice via tester worker.');
        }, 5_000_000);
    });

    // =======================================================================
    // 4. noriMint for Alice via tester
    //    (deposit-root seed step also goes through the tester worker)
    // =======================================================================
    describe('noriMint() via tester worker', () => {
        test('should seed deposit root then mint 200 bridge units for Alice', async () => {
            const aliceScramMsg = 'NoriZK';
            const totalLockedBU = 200n;

            const { merkleInput, scramWitness } = buildSyntheticDeposit(
                alice.privateKey,
                aliceScramMsg,
                totalLockedBU
            );

            const depositRoot =
                getContractDepositSlotRootFromContractDepositAndWitness(
                    merkleInput
                );
            await tester.adminSetDepositRoot(
                admin.privateKey.toBase58(),
                noriTokenBridgeKeypair.publicKey.toBase58(),
                depositRoot.toBigInt().toString(),
                '0',
                fee
            );

            await fetchAccount({
                publicKey: noriTokenBridgeKeypair.publicKey,
            });

            const merkleInputJson = merkleInputToJson(merkleInput);
            const signatureSCRAMBase58 = scramWitness.signature.toBase58();

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

            logger.log(`Alice minted ${balance} bridge units via tester worker.`);
        }, 5_000_000);
    });
});
