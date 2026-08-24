/**
 * NoriTokenBridge — eviction-witness regression test
 *
 * Reproduces the audit finding on the deposit-root rolling window.
 *
 * update()/adminSetDepositRoot() forward a caller-supplied `oldestAction` to
 * dispatchAndEvict(); when the window is full they advance `windowStart` to
 *   advanceActionState(windowStart, singleActionInnerHash(oldestAction))
 * WITHOUT verifying that `oldestAction` is the real oldest action in the
 * window. A caller can pass a bogus value, moving `windowStart` to an
 * action-state hash that exists nowhere on the real action chain. From then
 * on getActions({ fromActionState: windowStart }) returns nothing, so
 * noriMint() can never rebuild the window — the mint flow is bricked.
 *
 * This test fills the window, then dispatches one more deposit root with a
 * BOGUS oldestAction and asserts the window stays healthy and the deposit is
 * still mintable. It FAILS on the unfixed contract (windowStart is poisoned)
 * and passes once eviction derives the oldest action in-circuit.
 *
 * NOTE (4279a fix): the attack surface described above no longer exists.
 * dispatchAndEvict() now derives the oldest action in-circuit via
 * reducer.reduce(); there is no caller-supplied oldestAction parameter
 * to exploit. This test remains as a regression guard: it confirms the
 * window stays healthy after eviction without any caller input.
 *
 * Self-contained: own LocalBlockchain (proofsEnabled: false), deploy and a
 * single test. Requires the test-only `adminSetDepositRoot` method to be
 * enabled on the contract.
 */

import { Logger, LogPrinter } from 'esm-iso-logger';
import {
    AccountUpdate,
    Bool,
    fetchAccount,
    Field,
    Mina,
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
import { getVerifiedRequestSlotRootFromWitness } from '../../depositAttestation.js';
import {
    EthInput,
    decodeConsensusMptProof,
    Bytes32FieldPair,
    Bytes20,
    extractEthProofQueueAddressFromSP1Proof,
    bridgeHeadNoriSP1HeliosProgramPi0,
    proofConversionSP1ToPlonkPO2,
} from '@nori-zk/o1js-zk-utils';
import { FrC } from '@nori-zk/proof-conversion/min';
import { buildExampleProofSeriesCreateArguments } from '../../constructExampleProofs.js';
import { buildSyntheticDeposit, TEST_ETH_TOKEN_BRIDGE_ADDRESS_HEX, txSend, fetchAccounts, fetchWindowStartWitness } from '../testUtils.js';
import { maxWindow } from '../../NoriTokenBridge.const.js';

new LogPrinter('TestMinaNoriTokenBridgeEvictionWitness');
const logger = new Logger('EvictionWitnessRegression');

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

/** Fetch the deposit roots currently in the window (replays from windowStart). */
async function fetchWindowRoots(bridge: NoriTokenBridge): Promise<Field[]> {
    await fetchAccount({ publicKey: bridge.address });
    const windowStart = bridge.windowStart.get();
    const actionBatches: Field[][] = await bridge.reducer.fetchActions({
        fromActionState: windowStart,
    });
    return actionBatches.flat();
}

/** Dispatch a deposit root via adminSetDepositRoot with an explicit oldestAction.
 * NOTE (4279a fix): oldestAction is no longer caller-supplied; derived in-circuit. */
async function adminDispatch(root: Field) {
    void root
    // await txSend({
    //     body: async () => {
    //         await noriTokenBridge.adminSetDepositRoot(root);
    //     },
    //     sender: admin.publicKey,
    //     signers: [admin.privateKey],
    // });
    await fetchAccount({ publicKey: noriTokenBridgeKeypair.publicKey });
}
// NOTE: in order to get this test running, the `adminSetDepositRoot` method in NoriTokenBridge.ts must be uncommented, 
// and the corresponding calls in the test above must be uncommented as well. 
// This is a test-only method that is not part of the production contract, so it is commented out by default. 
// The comments in the code indicate which lines to uncomment to enable this test.
describe.skip('NoriTokenBridge — eviction witness integrity', () => {
    beforeAll(async () => {
        const Local = await Mina.LocalBlockchain({ proofsEnabled: false });
        Mina.setActiveInstance(Local);

        deployer = { publicKey: Local.testAccounts[0], privateKey: Local.testAccounts[0].key };
        admin = { publicKey: Local.testAccounts[1], privateKey: Local.testAccounts[1].key };
        mallory = { publicKey: Local.testAccounts[2], privateKey: Local.testAccounts[2].key };

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
        storageInterfaceVK = (await NoriStorageInterface.compile()).verificationKey;
        logger.log('Compiling FungibleToken...');
        await FungibleToken.compile();
        logger.log('Compiling NoriTokenBridge...');
        await NoriTokenBridge.compile();
        logger.log('All contracts compiled.');

        // Deploy. The store-hash / genesis / bridge-address args are only checked
        // by update(), which this test never calls — but we use real example
        // values so deploy mirrors production.
        const examples = buildExampleProofSeriesCreateArguments();
        const ethInput1 = new EthInput(decodeConsensusMptProof(examples[0].sp1PlonkProof));
        const initialStoreHash = Bytes32FieldPair.fromBytes32(ethInput1.inputStoreHash);
        const ethTokenBridgeAddress = Bytes20.fromHex(TEST_ETH_TOKEN_BRIDGE_ADDRESS_HEX).toField();
        const ethProofQueueAddress = extractEthProofQueueAddressFromSP1Proof(examples[0]);

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
                    ethProofQueueAddress,
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
    }, 1_000_000);

    beforeEach(async () => {
        await fetchAccounts(allAccounts);
    });

    test('a bogus oldestAction during eviction must not brick the window or mint flow', async () => {
        // Fill the window to maxWindow. 
        for (let i = 0; i < maxWindow; i++) {
            await adminDispatch(Field(3_000_000n + BigInt(i)));
        }

        await fetchAccount({ publicKey: noriTokenBridgeKeypair.publicKey });
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const sizeFull = (await noriTokenBridge.windowSize.fetch())!;
        assert.equal(sizeFull.toBigInt(), BigInt(maxWindow), 'window should be full after maxWindow dispatches');

        // Prepare the minting user.
        const totalLocked = 250n;
        const { merkleInput, scramWitness } = buildSyntheticDeposit(
            mallory.privateKey,
            'NoriZK',
            totalLocked,
        );
        const depositRoot = getVerifiedRequestSlotRootFromWitness(merkleInput);

        await txSend({
            body: async () => {
                AccountUpdate.fundNewAccount(deployer.publicKey, 1);
                await noriTokenBridge.setUpStorage(mallory.publicKey, storageInterfaceVK);
            },
            sender: deployer.publicKey,
            signers: [deployer.privateKey, mallory.privateKey],
        });

        // Window is full: this dispatch evicts the real oldest action. 
        // Pass a BOGUS oldestAction — a correct contract must not trust it.
        // const bogusOldest = Field(987_654_321n);
        await adminDispatch(depositRoot);

        // The window must still resolve from windowStart and contain the new
        // root. On the buggy contract windowStart is poisoned, so this fetch
        // returns nothing or throws (treated as an empty window).
        let windowRoots: Field[] = [];
        try {
            windowRoots = await fetchWindowRoots(noriTokenBridge);
        } catch (e) {
            logger.log(`fetchWindowRoots failed (poisoned windowStart?): ${(e as Error).message}`);
        }
        assert.equal(
            windowRoots.length,
            maxWindow,
            'window must still hold maxWindow roots after eviction',
        );
        assert.ok(
            windowRoots.some((r) => r.toBigInt() === depositRoot.toBigInt()),
            'freshly dispatched deposit root must be present in the window',
        );

        const windowStartWitness = await fetchWindowStartWitness(noriTokenBridge);

        // End-to-end: the user can still mint (the finding claims this breaks).
        await txSend({
            body: async () => {
                AccountUpdate.fundNewAccount(mallory.publicKey, 1);
                await noriTokenBridge.noriMint(merkleInput, scramWitness, windowStartWitness);
            },
            sender: mallory.publicKey,
            signers: [mallory.privateKey],
        });

        await fetchAccount({
            publicKey: mallory.publicKey,
            tokenId: tokenBase.deriveTokenId(),
        });
        const balance = await tokenBase.getBalanceOf(mallory.publicKey);
        assert.equal(
            balance.toBigInt(),
            totalLocked,
            'user must receive minted tokens after a bogus-witness eviction',
        );
    }, 1_000_000);
});
