/**
 * NoriTokenBridge Happy-Path Test Suite (Lightnet)
 *
 * Minimal ordered flow: deploy → set integrity params → update (4 blocks) →
 * setUpStorage → noriMint.
 *
 * Requires: Lightnet running at http://localhost:8080/graphql (accountManager at :8181)
 */

import { Logger, LogPrinter } from 'esm-iso-logger';
import {
    AccountUpdate,
    Bool,
    Cache,
    fetchAccount,
    Field,
    Mina,
    type NetworkId,
    Poseidon,
    PrivateKey,
    type PublicKey,
    UInt8,
} from 'o1js';
// VerificationKey must be a value import for @method decorator runtime validation
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { VerificationKey } from 'o1js';
import assert from 'node:assert';
import { FungibleToken } from '../../TokenBase.js';
import { NoriStorageInterface } from '../../NoriStorageInterface.js';
import { NoriTokenBridge } from '../../NoriTokenBridge.js';
import { getContractDepositSlotRootFromContractDepositAndWitness } from '../../depositAttestation.js';
import {
    EthInput,
    NodeProofLeft,
    decodeConsensusMptProof,
    Bytes32FieldPair,
    extractEthTokenBridgeAddressFromSP1Proof,
    extractGenesisRootFromSP1Proof,
    bridgeHeadNoriSP1HeliosProgramPi0,
    proofConversionSP1ToPlonkPO2,
} from '@nori-zk/o1js-zk-utils';
import type { NodeProofLeft as NodeProofLeftRaw } from '@nori-zk/proof-conversion/min';
import { FrC } from '@nori-zk/proof-conversion/min';
import { buildExampleProofSeriesCreateArguments } from '../../constructExampleProofs.js';
import { getNewMinaLiteNetAccountKeyPair, keyPairBase58ToKeyPair, buildSyntheticDeposit } from '../testUtils.js';

new LogPrinter('TestMinaNoriTokenBridge');
const logger = new Logger('HappyPathLightnetTest');

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

let allAccounts: PublicKey[];

const examples = buildExampleProofSeriesCreateArguments();
type RawProof = NodeProofLeftRaw;
let ethInput1: EthInput;
let rawProof1: RawProof;

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
describe('NoriTokenBridge Happy Path', () => {
    beforeAll(async () => {
        const Network = Mina.Network({
            networkId: 'testnet' as NetworkId,
            mina: process.env.MINA_RPC_NETWORK_URL ?? 'http://localhost:8080/graphql',
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

        // Compile in dependency order
        logger.log('Compiling NoriStorageInterface...');
        storageInterfaceVK = (await NoriStorageInterface.compile({ cache: Cache.None }))
            .verificationKey;
        logger.log('Compiling FungibleToken...');
        await FungibleToken.compile({ cache: Cache.None });
        logger.log('Compiling NoriTokenBridge...');
        await NoriTokenBridge.compile({ cache: Cache.None });
        logger.log('All contracts compiled.');

        // Decode example proofs
        logger.log('Decoding test example proofs...');

        const decoded1 = decodeConsensusMptProof(examples[0].sp1PlonkProof);
        ethInput1 = new EthInput(decoded1);
        rawProof1 = await NodeProofLeft.fromJSON(examples[0].conversionOutputProof.proofData);

        logger.log('All example proofs decoded.');
    }, 1_000_000);

    beforeEach(async () => {
        await fetchAccounts(allAccounts);
    });

    // ── 1. Deploy ──────────────────────────────────────────────────────────
    test('1. deploy NoriTokenBridge and FungibleToken', async () => {
        const initialStoreHash = Bytes32FieldPair.fromBytes32(ethInput1.inputStoreHash);
        const ethTokenBridgeAddress = extractEthTokenBridgeAddressFromSP1Proof(examples[0]);
        const genesisRoot = extractGenesisRootFromSP1Proof(examples[0]);

        await txSend({
            body: async () => {
                AccountUpdate.fundNewAccount(deployer.publicKey, 3);

                await noriTokenBridge.deploy({
                    adminPublicKey: admin.publicKey,
                    tokenBaseAddress: tokenBaseKeypair.publicKey,
                    storageVKHash: storageInterfaceVK.hash,
                    newStoreHash: initialStoreHash,
                    ethTokenBridgeAddress,
                    noriHeliosProgramPi0: FrC.from(bridgeHeadNoriSP1HeliosProgramPi0),
                    proofConversionPO2: Field.from(proofConversionSP1ToPlonkPO2),
                    genesisRoot,
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
        assert.equal(onchainAdmin.toBase58(), admin.publicKey.toBase58(), 'adminPublicKey mismatch');

        const onchainTokenBase = await noriTokenBridge.tokenBaseAddress.fetch();
        assert.equal(onchainTokenBase.toBase58(), tokenBaseKeypair.publicKey.toBase58(), 'tokenBaseAddress mismatch');

        const mintLock = await noriTokenBridge.mintLock.fetch();
        assert.equal(mintLock.toBoolean(), true, 'mintLock should be true after deploy');

        logger.log('Deployment verified.');
    }, 1_000_000);

    // ── 2. update() — 1 block ────────────────────────────────
    test('2a. update block 1', async () => {
        await txSend({
            body: async () => {
                await noriTokenBridge.update(ethInput1, rawProof1, Field(0));
            },
            sender: deployer.publicKey,
            signers: [deployer.privateKey],
        });

        await fetchAccount({ publicKey: noriTokenBridgeKeypair.publicKey });
        const head = await noriTokenBridge.latestHead.fetch();
        assert.equal(head.toBigInt(), ethInput1.outputSlot.toBigInt(), 'latestHead after block 1');
        logger.log(`latestHead advanced to slot ${head} (block 1)`);
    }, 1_000_000);

    // ── 3. setUpStorage for Alice ─────────────────────────────────────────
    test('3. setUpStorage for Alice', async () => {
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

        logger.log('Storage initialised for Alice.');
    }, 1_000_000);

    // ── 4. noriMint for Alice ─────────────────────────────────────────────
    // -----------------------------------------------------------------------
    // test.skip('4. noriMint for Alice'): the test is gated on
    // `adminSetDepositRoot`, which is commented out on the production
    // contract for safety (see `contracts/mina/src/NoriTokenBridge.ts`).
    // The test-only method exists so we can seed deposit roots directly
    // into the rolling window without generating a full SP1 proof for
    // each synthetic deposit. To re-run this test against lightnet,
    // uncomment the contract method and the call site below.
    // -----------------------------------------------------------------------
    test.skip('4. noriMint for Alice', async () => {
        const aliceScramMsg = 'NoriZK';
        const totalLockedBU = 200n;

        const { merkleInput, scramWitness } = buildSyntheticDeposit(
            alice.privateKey,
            aliceScramMsg,
            totalLockedBU
        );

        // Seed the deposit root into the contract window
        const depositRoot = getContractDepositSlotRootFromContractDepositAndWitness(merkleInput);
        void depositRoot;
        // adminSetDepositRoot disabled in production — see test-level note above.
        // await txSend({
        //     body: async () => {
        //         await noriTokenBridge.adminSetDepositRoot(depositRoot, Field(0));
        //     },
        //     sender: admin.publicKey,
        //     signers: [admin.privateKey],
        // });
        await fetchAccount({ publicKey: noriTokenBridgeKeypair.publicKey });

        // Mint
        const windowStartWitness = await noriTokenBridge.windowStart.fetch();
        if (windowStartWitness === undefined) throw new Error('could not fetch windowStart');
        await txSend({
            body: async () => {
                AccountUpdate.fundNewAccount(alice.publicKey, 1);
                await noriTokenBridge.noriMint(merkleInput, scramWitness, windowStartWitness);
            },
            sender: alice.publicKey,
            signers: [alice.privateKey],
        });

        await fetchAccount({
            publicKey: alice.publicKey,
            tokenId: tokenBase.deriveTokenId(),
        });

        const balance = await tokenBase.getBalanceOf(alice.publicKey);
        assert.equal(balance.toBigInt(), totalLockedBU, `Alice should hold ${totalLockedBU} bridge units`);

        const storage = new NoriStorageInterface(
            alice.publicKey,
            noriTokenBridge.deriveTokenId()
        );
        const mintedSoFar = await storage.mintedSoFar.fetch();
        assert.equal(mintedSoFar.toBigInt(), totalLockedBU, `mintedSoFar should record ${totalLockedBU} bridge units`);

        logger.log(`Alice minted ${balance} bridge units successfully.`);
    }, 1_000_000);
});
