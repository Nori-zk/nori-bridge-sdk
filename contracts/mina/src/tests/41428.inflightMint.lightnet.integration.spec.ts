/**
 * NoriTokenBridge — in-flight mint invalidation fix, green proof (Finding 41428, Lightnet)
 *
 * This lightnet test demonstrates the fix: with `noriMint` taking the window
 * start as a WITNESS (no on-chain `windowStart` precondition), a mint proven
 * before an `update` is still accepted after that update — the only remaining
 * shared precondition is `actionState`, which tolerates the last ~4 updates.
 *
 * Runs with maxWindow = 2 so filling the window is only a couple of real txs.
 *
 * Requires: Lightnet at http://localhost:8080/graphql (accountManager :8181,
 * archive :8282) and the test-only `adminSetDepositRoot` method enabled.
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
    PrivateKey,
    type PublicKey,
    UInt8,
} from 'o1js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { VerificationKey } from 'o1js';
import assert from 'node:assert';
import { FungibleToken } from '../TokenBase.js';
import { NoriStorageInterface } from '../NoriStorageInterface.js';
import { NoriTokenBridge } from '../NoriTokenBridge.js';
import { getContractDepositSlotRootFromContractDepositAndWitness } from '../depositAttestation.js';
import {
    EthInput,
    decodeConsensusMptProof,
    Bytes32FieldPair,
    extractEthTokenBridgeAddressFromSP1Proof,
    extractGenesisRootFromSP1Proof,
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
import { maxWindow } from '../NoriTokenBridge.const.js';

new LogPrinter('TestMinaNoriTokenBridgeInflightMintLightnet');
const logger = new Logger('InflightMintLightnetRegression');

const fee = Number(process.env.MINA_TX_FEE ?? 0.1) * 1e9;

type Keypair = { publicKey: PublicKey; privateKey: PrivateKey };

let deployer: Keypair;
let admin: Keypair;
let mallory: Keypair;

let tokenBaseKeypair: Keypair;
let tokenBase: FungibleToken;

let noriTokenBridgeKeypair: Keypair;
let noriTokenBridge: NoriTokenBridge;

let storageInterfaceVK: VerificationKey;
let allAccounts: PublicKey[];

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

/** Fetch the deposit roots currently in the window (replays from windowStart). */
async function fetchWindowRoots(): Promise<Field[]> {
    const windowStart = await noriTokenBridge.windowStart.fetch();
    if (windowStart === undefined) throw new Error('could not fetch windowStart');
    const actionBatches: Field[][] = await noriTokenBridge.reducer.fetchActions({
        fromActionState: windowStart,
    });
    return actionBatches.flat();
}

/** The real oldest action to evict: Field(0) until full, else the first window root. */
async function honestOldest(): Promise<Field> {
    const windowRoots = await fetchWindowRoots();
    if (windowRoots.length < maxWindow) return Field(0);
    return windowRoots[0];
}

/** Dispatch a deposit root via adminSetDepositRoot, passing the real oldest action. */
async function adminDispatch(root: Field) {
    const oldest = await honestOldest();
    await txSend({
        body: async () => {
            await noriTokenBridge.adminSetDepositRoot(root, oldest);
        },
        sender: admin.publicKey,
        signers: [admin.privateKey],
    });
    await fetchAccount({ publicKey: noriTokenBridgeKeypair.publicKey });
}

describe('NoriTokenBridge — in-flight mint invalidation (lightnet green proof)', () => {
    beforeAll(async () => {
        const Network = Mina.Network({
            networkId: 'testnet' as NetworkId,
            mina: process.env.MINA_RPC_NETWORK_URL ?? 'http://localhost:8080/graphql',
            archive: process.env.MINA_ARCHIVE_RPC_URL ?? 'http://localhost:8282',
        });
        Mina.setActiveInstance(Network);

        deployer = keyPairBase58ToKeyPair(await getNewMinaLiteNetAccountKeyPair());
        admin = keyPairBase58ToKeyPair(await getNewMinaLiteNetAccountKeyPair());
        mallory = keyPairBase58ToKeyPair(await getNewMinaLiteNetAccountKeyPair());

        tokenBaseKeypair = PrivateKey.randomKeypair();
        noriTokenBridgeKeypair = PrivateKey.randomKeypair();

        tokenBase = new FungibleToken(tokenBaseKeypair.publicKey);
        noriTokenBridge = new NoriTokenBridge(noriTokenBridgeKeypair.publicKey);

        allAccounts = [
            deployer.publicKey,
            admin.publicKey,
            mallory.publicKey,
            tokenBaseKeypair.publicKey,
            noriTokenBridgeKeypair.publicKey,
        ];

        logger.log('Compiling NoriStorageInterface...');
        storageInterfaceVK = (await NoriStorageInterface.compile({ cache: Cache.None })).verificationKey;
        logger.log('Compiling FungibleToken...');
        await FungibleToken.compile({ cache: Cache.None });
        logger.log('Compiling NoriTokenBridge...');
        await NoriTokenBridge.compile({ cache: Cache.None });
        logger.log('All contracts compiled.');

        const examples = buildExampleProofSeriesCreateArguments();
        const ethInput1 = new EthInput(decodeConsensusMptProof(examples[0].sp1PlonkProof));
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
        logger.log('Contracts deployed.');
    }, 3_000_000);

    beforeEach(async () => {
        await fetchAccounts(allAccounts);
    });

    test('a mint proven before an update is still accepted after that update', async () => {
        // Fill the window to maxWindow with dummies.
        for (let i = 0; i < maxWindow; i++) {
            await adminDispatch(Field(4_000_000n + BigInt(i)));
        }
        logger.log(`Window filled to maxWindow=${maxWindow}.`);

        // Seed mallory's deposit as the newest window member (evicts the oldest dummy).
        const totalLocked = 250n;
        const { merkleInput, scramWitness } = buildSyntheticDeposit(
            mallory.privateKey,
            'NoriZK',
            totalLocked,
        );
        const depositRoot = getContractDepositSlotRootFromContractDepositAndWitness(merkleInput);

        await txSend({
            body: async () => {
                AccountUpdate.fundNewAccount(deployer.publicKey, 1);
                await noriTokenBridge.setUpStorage(mallory.publicKey, storageInterfaceVK);
            },
            sender: deployer.publicKey,
            signers: [deployer.privateKey, mallory.privateKey],
        });

        await adminDispatch(depositRoot);

        // Snapshot the window start the user would witness when building their proof.
        const windowStartWitness = await noriTokenBridge.windowStart.fetch();
        if (windowStartWitness === undefined) throw new Error('could not fetch windowStart');
        logger.log(`Mint proof will witness windowStart = ${windowStartWitness.toString()}.`);

        // Build AND prove the mint now (as a user would), passing the witnessed window start.
        await fetchAccounts(allAccounts);
        const mintTx = await Mina.transaction(
            { sender: mallory.publicKey, fee },
            async () => {
                AccountUpdate.fundNewAccount(mallory.publicKey, 1);
                await noriTokenBridge.noriMint(merkleInput, scramWitness, windowStartWitness);
            }
        );
        await mintTx.prove();
        mintTx.sign([mallory.privateKey]);
        logger.log('Mint proven and signed (held, not yet sent).');

        // An `update` lands before the mint is included: one dispatch slides windowStart.
        await adminDispatch(Field(5_000_000n));

        const windowStartAfter = await noriTokenBridge.windowStart.fetch();
        if (windowStartAfter === undefined) throw new Error('could not fetch windowStart');
        assert.notEqual(
            windowStartAfter.toBigInt(),
            windowStartWitness.toBigInt(),
            'sanity: the intervening update must have moved windowStart',
        );
        logger.log(
            `Intervening update applied: windowStart ${windowStartWitness.toString()} -> ${windowStartAfter.toString()} ` +
            `(stale for the held mint).`
        );

        // Send the already-proven mint. With the witness fix and only one
        // intervening update (within the 5-slot actionState tolerance), it is
        // accepted — on the old contract the stale windowStart precondition
        // would have rejected it.
        let mintErr: Error | undefined;
        try {
            const pending = await mintTx.send();
            await pending.wait();
        } catch (e) {
            mintErr = e as Error;
            logger.log(`mint rejected: ${mintErr.message}`);
        }
        assert.ok(
            !mintErr,
            `in-flight mint must not be rejected by an intervening update: ${mintErr?.message ?? ''}`,
        );
        logger.log('GREEN: in-flight mint ACCEPTED despite the intervening update (stale windowStart no longer pins).');

        await fetchAccount({
            publicKey: mallory.publicKey,
            tokenId: tokenBase.deriveTokenId(),
        });
        const balance = await tokenBase.getBalanceOf(mallory.publicKey);
        assert.equal(
            balance.toBigInt(),
            totalLocked,
            'user must receive minted tokens despite the intervening update',
        );
        logger.log(`mallory balance = ${balance.toBigInt()} (expected ${totalLocked}).`);
    }, 3_000_000);
});
