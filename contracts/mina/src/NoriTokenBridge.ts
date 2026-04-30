// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import {
    AccountUpdate,
    assert,
    Bool,
    Field,
    SmartContract,
    State,
    method,
    state,
    Poseidon,
    UInt64,
    PublicKey,
    Permissions,
    TokenContract,
    Provable,
    type DeployArgs,
    UInt8,
    Bytes,
    Struct,
    Reducer
} from 'o1js';
// NodeProofLeft must be a value import for @method decorator runtime validation
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import {
    FrC,
    NodeProofLeft,
    parsePlonkPublicInputsProvable,
} from '@nori-zk/proof-conversion/min';
// VerificationKey/AccountUpdateForest must be a value import for @method decorator runtime validation
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { VerificationKey, AccountUpdateForest } from 'o1js';
// EthInput must be a value import for @method decorator runtime validation
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { EthInput, bytes32LEToFieldProvable, Bytes20 } from '@nori-zk/scrap-o1js-zk-utils';
import {
    Bytes32,
    Bytes32FieldPair,
    proofConversionSP1ToPlonkVkData,
} from '@nori-zk/scrap-o1js-zk-utils';
import { NoriStorageInterface } from './NoriStorageInterface.js';
import { FungibleToken } from './TokenBase.js';
import {
    extractCodeChallengeAndTotalLocked,
    getContractDepositSlotRootFromContractDepositAndWitness,
} from './depositAttestation.js';
// MerkleTreeContractDepositAttestorInput must be a value import for @method decorator runtime validation
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { MerkleTreeContractDepositAttestorInput } from './depositAttestation.js';
// SCRAMWitness must be a value import for @method decorator runtime validation
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SCRAMWitness, verifyCodeChallenge } from './scram.js';
import { maxWindow, minBridgeBurnAmount } from './NoriTokenBridge.const.js';

export type FungibleTokenAdminBase = SmartContract & {
    canMint(accountUpdate: AccountUpdate): Promise<Bool>;
    canChangeAdmin(admin: PublicKey): Promise<Bool>;
    canPause(): Promise<Bool>;
    canResume(): Promise<Bool>;
    canChangeVerificationKey(vk: VerificationKey): Promise<Bool>;
};
// ---------------------------------------------------------------------------
// Action hash-chain helpers (match Mina's internal Poseidon-based action hashing)
// See: o1js/src/lib/mina/v1/events.ts — Actions.pushEvent / updateSequenceState
// ---------------------------------------------------------------------------
function poseidonInitialState(): [Field, Field, Field] {
    return [Field(0), Field(0), Field(0)];
}
function poseidonSalt(prefix: string): [Field, Field, Field] {
    // Encode prefix string as a single Field (same as o1js prefixToField)
    const bytes = new TextEncoder().encode(prefix);
    let acc = 0n;
    for (let i = bytes.length - 1; i >= 0; i--) {
        acc = acc * 256n + BigInt(bytes[i]);
    }
    return Poseidon.update(poseidonInitialState(), [Field(acc)]);
}
function hashWithPrefix(prefix: string, input: Field[]): Field {
    return Poseidon.update(poseidonSalt(prefix), input)[0];
}

/** Hash of an empty inner action list: salt('MinaZkappActionsEmpty')[0] */
const emptyActionsHash = poseidonSalt('MinaZkappActionsEmpty')[0];

/**
 * Compute the inner action-list hash for a single-action transaction.
 * Matches: Actions.pushEvent(Actions.empty(), [actionField])
 *   = hashWithPrefix('MinaZkappSeqEvents**', [emptyActionsHash, hashWithPrefix('MinaZkappEvent******', [action])])
 */
function singleActionInnerHash(action: Field): Field {
    const eventHash = hashWithPrefix('MinaZkappEvent******', [action]);
    return hashWithPrefix('MinaZkappSeqEvents**', [emptyActionsHash, eventHash]);
}

/**
 * Advance the outer action-state by one transaction (which contained one action).
 * Matches: Actions.updateSequenceState(state, innerHash)
 *   = hashWithPrefix('MinaZkappSeqEvents**', [state, innerHash])
 */
function advanceActionState(state: Field, innerHash: Field): Field {
    return hashWithPrefix('MinaZkappSeqEvents**', [state, innerHash]);
}

export interface NoriTokenControllerDeployProps extends Exclude<
    DeployArgs,
    undefined
> {
    adminPublicKey: PublicKey;
    tokenBaseAddress: PublicKey;
    storageVKHash: Field;
    newStoreHash: Bytes32FieldPair;
    ethTokenBridgeAddress: Field;
    noriHeliosProgramPi0: FrC;
    proofConversionPO2: Field;
}

export class BurnEvent extends Struct({
    from: PublicKey,
    amount: UInt64,
    burnedSoFar: UInt64,
    receiverEth: Field
}) { }

class DepositRootAction extends Field { }

/**
 * NoriTokenBridge — Mina anchor for the Nori ETH ↔ Mina token bridge.
 *
 * Verifies SP1 consensus MPT transition proofs (`update`), maintains a rolling
 * window of verified Ethereum deposit roots, and mints the corresponding
 * FungibleToken balance when a user presents a matching deposit plus SCRAM
 * witness (`noriMint`). Also supports burning for the Mina → ETH direction
 * (`alignedLock`).
 *
 * Acts as the admin contract for the FungibleToken — `canMint` gates minting
 * via a single-use `mintLock` flag that `noriMint` flips immediately before
 * calling `token.mint`. Direct calls to `FungibleToken.mint` therefore fail.
 */
export class NoriTokenBridge
    extends TokenContract
    implements FungibleTokenAdminBase {
    /** Admin key authorised to set integrity params, update VKs, rotate the store hash, and inject deposit roots. */
    @state(PublicKey) adminPublicKey = State<PublicKey>();
    /** Address of the FungibleToken this bridge mints into / burns from. */
    @state(PublicKey) tokenBaseAddress = State<PublicKey>();
    /** Required VK hash for every per-user NoriStorageInterface account (enforced in setUpStorage). */
    @state(Field) storageVKHash = State<Field>();
    /**
     * Single-use mint gate. `noriMint` clears this (false) just before calling
     * `token.mint`; `canMint` then requires it false and re-locks it (true).
     * Any `FungibleToken.mint` call not originating from `noriMint` fails
     * because the lock remains true.
     */
    @state(Bool) mintLock = State<Bool>();

    /** Poseidon hash of the most recently verified Ethereum execution state root (Field(1) before the first update). */
    @state(Field) verifiedStateRoot = State<Field>();
    /** Latest Ethereum slot verified by this bridge (strictly increasing). */
    @state(UInt64) latestHead = State<UInt64>();
    /** Chain-linkage hash (high byte) — the next proof's `inputStoreHash` must match this + lower bytes. */
    @state(Field) latestHeliusStoreInputHashHighByte = State<Field>();
    /** Chain-linkage hash (lower 31 bytes), pair with `latestHeliusStoreInputHashHighByte`. */
    @state(Field) latestHeliusStoreInputHashLowerBytes = State<Field>();
    /** Deposits root from the most recent successful `update` (exposed for off-chain consumers). */
    @state(Field) latestVerifiedContractDepositsRoot = State<Field>();
    /**
     * Public input 0 from the SP1 consensus MPT transition proof (sp1Proof.proof.Plonk.public_inputs[0]),
     * the Nori SP1 Helios program identifier (bridgeHeadNoriSP1HeliosProgramPi0).
     * Canonical value committed in o1js-zk-utils/src/integrity/nori-sp1-helios-program.pi0.json —
     * a copy of nori-elf/nori-sp1-helios-program.pi0.json from bridge-head.
     * Set on-chain via updateNoriHeliosProgramPi0 after deployment (not baked into the circuit).
     * Changes frequently as the Helios light client evolves.
     */
    @state(FrC) noriHeliosProgramPi0 = State<FrC>();
    /**
     * Public output 2 from the converted consensus MPT transition proof
     * (proofConversionOutput.proofData.publicOutput[2]).
     * Canonical value committed in o1js-zk-utils/src/integrity/ProofConversion.sp1ToPlonk.po2.json.
     * Set on-chain via updateProofConversionPO2 after deployment (not baked into the circuit).
     * Infrequently changes, for instance when SP1 undergoes a major version upgrade
     * (e.g. v5 -> v6) that affects the cryptography of proof conversion.
     */
    @state(Field) proofConversionPO2 = State<Field>();

    /** Action-state hash marking the start of the valid deposit-root window. */
    @state(Field) windowStart = State<Field>();
    /** Number of deposit-root actions currently in the window (max maxWindow). */
    @state(Field) windowSize = State<Field>();
    /** The Ethereum contract address associated with this token bridge. */
    @state(Field) ethTokenBridgeAddress = State<Field>();

    readonly events = {
        Burn: BurnEvent
    };
    reducer = Reducer({ actionType: DepositRootAction });

    async deploy(props: NoriTokenControllerDeployProps) {
        await super.deploy(props);
        this.adminPublicKey.set(props.adminPublicKey);
        this.tokenBaseAddress.set(props.tokenBaseAddress);
        this.storageVKHash.set(props.storageVKHash);
        this.mintLock.set(Bool(true));
        this.account.permissions.set({
            ...Permissions.default(),
            setVerificationKey: Permissions.VerificationKey.proofOrSignature(),
            setPermissions: Permissions.impossible(),
            editState: Permissions.proof(),
            send: Permissions.proof(),
            // Must stay proof-only until o1js supports `Precondition on Account
            // Permissions` — otherwise a token-owner signature could approve
            // arbitrary account updates against this contract.
            access: Permissions.proof()
        });
        const isInitialized = this.account.provedState.getAndRequireEquals();
        isInitialized.assertFalse('NoriTokenBridge has already been initialized!');

        // Set initial state (TODO set these to real values!)
        this.latestHead.set(UInt64.from(0));
        this.verifiedStateRoot.set(Field(1));
        // Set inital state of store hash.
        // await this.updateStoreHash(newStoreHash); // Reintroduce this instead of the immediate below when we can
        // verify that this.admin.getAndRequireEquals() == adminPublicKey immediately after this.admin.set(adminPublicKey);
        this.latestHeliusStoreInputHashHighByte.set(
            props.newStoreHash.highByteField
        );
        this.latestHeliusStoreInputHashLowerBytes.set(
            props.newStoreHash.lowerBytesField
        );

        // Action window starts empty
        this.windowStart.set(Reducer.initialActionState);
        this.windowSize.set(Field(0));

        this.ethTokenBridgeAddress.set(props.ethTokenBridgeAddress);

        this.noriHeliosProgramPi0.set(props.noriHeliosProgramPi0);
        this.proofConversionPO2.set(props.proofConversionPO2);
    }

    approveBase(_forest: AccountUpdateForest): Promise<void> {
        throw Error('block updates');
    }

    private ethVerify(input: EthInput, proof: NodeProofLeft) {
        // sp1Proof.proof.Plonk.public_inputs[0] — read from on-chain state (set via updateNoriHeliosProgramPi0)
        const ethPlonkVK = this.noriHeliosProgramPi0.getAndRequireEquals();

        // proofConversionOutput.proofData.publicOutput[2] — read from on-chain state (set via updateProofConversionPO2)
        const ethNodeVk = this.proofConversionPO2.getAndRequireEquals();

        // Verification of proof conversion
        // vk = proofConversionOutput.vkData
        // this is also from nodeVK
        const vk = VerificationKey.fromJSON(proofConversionSP1ToPlonkVkData);


        proof.verify(vk);

        // Passed proof matches extracted public entry 2
        proof.publicOutput.subtreeVkDigest.assertEquals(ethNodeVk);
        Provable.log('newHead slot', input.outputSlot);

        // Verification of the input
        let bytes: UInt8[] = [];
        bytes = bytes.concat(input.inputSlot.toBytesBE());
        bytes = bytes.concat(input.inputStoreHash.bytes);
        bytes = bytes.concat(input.outputSlot.toBytesBE());
        bytes = bytes.concat(input.outputStoreHash.bytes);
        bytes = bytes.concat(input.executionStateRoot.bytes);
        bytes = bytes.concat(input.verifiedContractDepositsRoot.bytes);
        bytes = bytes.concat(input.nextSyncCommitteeHash.bytes);
        bytes = bytes.concat(input.contractAddress.bytes);


        // Check that zkprograminput is same as passed to the SP1 program
        const pi0 = ethPlonkVK;
        const pi1 = parsePlonkPublicInputsProvable(Bytes.from(bytes));

        const piDigest = Poseidon.hashPacked(Provable.Array(FrC.provable, 2), [
            pi0,
            pi1,
        ]);

        Provable.log('piDigest', piDigest);
        Provable.log(
            'proof.publicOutput.rightOut',
            proof.publicOutput.rightOut
        );

        piDigest.assertEquals(proof.publicOutput.rightOut);
        return input.contractAddress.bytes;
    }

    /**
     * Verify an SP1 consensus MPT transition proof and advance the bridge
     * head. On success:
     *   - `latestHead` is set to `input.outputSlot` (must strictly increase)
     *   - `verifiedStateRoot` is set to Poseidon(`input.executionStateRoot`)
     *   - `latestHeliusStoreInputHash{HighByte,LowerBytes}` advance to the
     *     new store hash (prior values must match the proof's `inputStoreHash`)
     *   - `input.verifiedContractDepositsRoot` is dispatched into the rolling
     *     window; when the window is full, `oldestAction` is consumed as the
     *     eviction witness. Pass `Field(0)` when the window is not yet full.
     */
    @method async update(input: EthInput, proof: NodeProofLeft, oldestAction: Field) {
        // Verify transition proof.
        const ethTokenBridgeAddressBytes = this.ethVerify(input, proof);
        const ethTokenBridgeAddress = new Bytes20(ethTokenBridgeAddressBytes).toField();
        const expectedEthTokenBridgeAddress = this.ethTokenBridgeAddress.getAndRequireEquals();
        expectedEthTokenBridgeAddress.assertEquals(ethTokenBridgeAddress, "The contract address extracted from the proof must match the one set in the bridge head contract.");

        const proofHead = input.outputSlot;
        const executionStateRoot = input.executionStateRoot;
        const currentSlot = this.latestHead.getAndRequireEquals();

        const newStoreHash = Bytes32FieldPair.fromBytes32(
            input.outputStoreHash
        );

        Provable.asProver(() => {
            Provable.log('Proof input store hash values were:');
            Provable.log(input.outputStoreHash.bytes[0].value);
            Provable.log(
                input.outputStoreHash.bytes.slice(1, 33).map((b) => b.value)
            );
            Provable.log(
                'Public outputs created:',
                newStoreHash.highByteField,
                newStoreHash.lowerBytesField
            );
            Provable.log('Current slot', currentSlot);
        });

        const prevStoreHash = Bytes32FieldPair.fromBytes32(
            input.inputStoreHash
        );

        // Verification of the previous store hash higher byte.
        prevStoreHash.highByteField.assertEquals(
            this.latestHeliusStoreInputHashHighByte.getAndRequireEquals(),
            "The latest transition proofs' input helios store hash higher byte, must match the contracts' helios store hash higher byte."
        );

        Provable.asProver(() => {
            Provable.log(
                'ethProof.prevStoreHashHighByteField vs this.latestHeliusStoreInputHashHighByte',
                prevStoreHash.highByteField.toString(),
                this.latestHeliusStoreInputHashHighByte.get().toString()
            );
        });

        // Verification of previous store hash lower bytes.
        prevStoreHash.lowerBytesField.assertEquals(
            this.latestHeliusStoreInputHashLowerBytes.getAndRequireEquals(),
            "The latest transition proofs' input helios store hash lower bytes, must match the contracts' helios store hash lower bytes."
        );

        Provable.asProver(() => {
            Provable.log(
                'ethProof.prevStoreHashLowerBytesField vs this.latestHeliusStoreInputHashLowerBytes',
                prevStoreHash.lowerBytesField.toString(),
                this.latestHeliusStoreInputHashLowerBytes.get().toString()
            );
        });

        // Verification of slot progress.
        proofHead.assertGreaterThan(
            currentSlot,
            'Proof head must be greater than current head.'
        );

        // Verification that next sync commitee is non zero (could brick the bridge head otherwise)
        let nextSyncCommitteeZeroAcc = new Field(0);
        for (let i = 0; i < 32; i++) {
            nextSyncCommitteeZeroAcc = nextSyncCommitteeZeroAcc.add(
                input.nextSyncCommitteeHash.bytes[i].value
            );
        }
        nextSyncCommitteeZeroAcc.assertNotEquals(new Field(0));

        // Extract the verifiedContractDepositsRoot and convert it to a Field
        const verifiedContractDepositsRootField = bytes32LEToFieldProvable(
            input.verifiedContractDepositsRoot.bytes
        );

        // Update contract values
        this.latestHead.set(proofHead);
        this.verifiedStateRoot.set(
            Poseidon.hashPacked(Bytes32.provable, executionStateRoot)
        );
        this.latestHeliusStoreInputHashHighByte.set(newStoreHash.highByteField);
        this.latestHeliusStoreInputHashLowerBytes.set(
            newStoreHash.lowerBytesField
        );
        this.latestVerifiedContractDepositsRoot.set(
            verifiedContractDepositsRootField
        );

        // Dispatch + window eviction
        this.dispatchAndEvict(verifiedContractDepositsRootField, oldestAction);
    }
    /**
     * Dispatch a new deposit root action and evict the oldest if the window is full.
     *
     * When the window has fewer than maxWindow actions, the new root is simply
     * appended (oldestAction is ignored — can be Field(0)).
     *
     * When the window is full, the caller must provide the oldest action as a
     * witness. The contract verifies the hash chain:
     *   advanceActionState(windowStart, singleActionInnerHash(oldestAction))
     * and advances windowStart by one step, keeping the window size constant.
     */
    private dispatchAndEvict(depositRoot: Field, oldestAction: Field) {
        // Dispatch the new deposit root as an action
        this.reducer.dispatch(depositRoot);

        let windowStart = this.windowStart.getAndRequireEquals();
        let windowSize = this.windowSize.getAndRequireEquals();

        const isFull = windowSize.greaterThanOrEqual(maxWindow);

        // Compute the advanced windowStart by verifying the oldest action chains correctly.
        // If isFull is false, this computation is ignored (oldestAction can be anything).
        const innerHash = singleActionInnerHash(oldestAction);
        const advancedStart = advanceActionState(windowStart, innerHash);

        // Conditionally advance: if full, slide the window; otherwise keep start.
        this.windowStart.set(Provable.if(isFull, advancedStart, windowStart));
        // If full: evict 1 + add 1 = same size. If not full: size + 1.
        this.windowSize.set(Provable.if(isFull, windowSize, windowSize.add(1)));
    }

    @method async setUpStorage(user: PublicKey, vk: VerificationKey) {
        let tokenAccUpdate = AccountUpdate.createSigned(
            user,
            this.deriveTokenId()
        );
        tokenAccUpdate.account.isNew.requireEquals(Bool(true));

        const storageVKHash = this.storageVKHash.getAndRequireEquals();
        storageVKHash.assertEquals(vk.hash);
        tokenAccUpdate.body.update.verificationKey = {
            isSome: Bool(true),
            value: vk,
        };
        tokenAccUpdate.body.update.permissions = {
            isSome: Bool(true),
            value: {
                ...Permissions.default(),
                editState: Permissions.proof(),
                // VK upgradability here?
                setVerificationKey:
                    Permissions.VerificationKey.impossibleDuringCurrentVersion(),
                setPermissions: Permissions.proof(), //imposible?
            },
        };

        AccountUpdate.setValue(
            tokenAccUpdate.update.appState[0], //NoriStorageInterface.userKeyHash
            Poseidon.hash(user.toFields())
        );
        AccountUpdate.setValue(
            tokenAccUpdate.update.appState[1], //NoriStorageInterface.mintedSoFar
            Field(0)
        );
    }
    @method public async noriMint(
        merkleTreeContractDepositAttestorInput: MerkleTreeContractDepositAttestorInput,
        SCRAMWitness: SCRAMWitness
    ) {
        const userAddress = this.sender.getAndRequireSignature();
        const tokenAddress = this.tokenBaseAddress.getAndRequireEquals();

        // Calculate the deposit slot root
        // This just proves that the index and value with the witness yield a root
        // Aka some value exists at some index and yields a certain root
        const contractDepositSlotRoot =
            getContractDepositSlotRootFromContractDepositAndWitness(
                merkleTreeContractDepositAttestorInput
            );

        // Check membership in the action-based deposit-root window.
        // Fetch actions from windowStart to current actionState, then reduce
        // to check if any dispatched root matches the computed deposit slot root.
        const windowStart = this.windowStart.getAndRequireEquals();
        const actions = this.reducer.getActions({ fromActionState: windowStart });

        const depositInWindow: Bool = this.reducer.reduce(
            actions,
            Bool,
            (found: Bool, action: Field) => found.or(action.equals(contractDepositSlotRoot)),
            Bool(false),
            { maxUpdatesWithActions: maxWindow }
        );

        depositInWindow.assertTrue(
            'The provided contract deposit and witness are not in the stored window of verified contract deposits root, and thus cannot be used to mint.'
        );

        // Bytes32FieldPair
        // Extract out the contract deposit credential and the tokens locked from the merkle merkleTreeContractDepositAttestorInput as fields
        const {
            totalLocked: totalLockedBridgeUnits,
            codeChallenge: codeChallengeSCRAM,
        } = extractCodeChallengeAndTotalLocked(
            merkleTreeContractDepositAttestorInput
        );

        // Verify the code challenge
        const { signature, message } = SCRAMWitness;
        verifyCodeChallenge(codeChallengeSCRAM, signature, userAddress, message);

        // Construct storage interface
        const controllerTokenId = this.deriveTokenId();
        let storage = new NoriStorageInterface(userAddress, controllerTokenId);

        // Require the storage account already exists (setUpStorage was called).
        // Without this precondition, reading appState below can fail out of range.
        storage.account.isNew.requireEquals(Bool(false));
        // Defence-in-depth: confirm this storage was set up for the minting user.
        // setUpStorage already binds user -> userKeyHash.
        storage.userKeyHash
            .getAndRequireEquals()
            .assertEquals(Poseidon.hash(userAddress.toFields()));

        // Derive amount to mint based of the total locked so far.
        const amountToMint = await storage.increaseMintedAmount(
            totalLockedBridgeUnits
        );
        Provable.log(amountToMint, 'amount to mint');

        let token = new FungibleToken(tokenAddress);
        this.mintLock.set(Bool(false));
        Provable.log(UInt64.fromFields(amountToMint.toFields()),
            'UInt64.fromFields(amountToMint.toFields())');
        // Mint!
        await token.mint(userAddress, UInt64.fromFields(amountToMint.toFields()));
    }
    /**
     * @param amountToBurn  the amount the user wants to burn on Mina. Must be greater than minBridgeBurnAmount.
     * @param receiver - the Ethereum address (as a Field) that will receive the bridged tokens on the other side. Must be provided by the user when burning.
     */
    @method public async alignedLock(
        amountToBurn: Field,
        receiver: Field
    ) {
        const userAddress = this.sender.getAndRequireSignature();
        const tokenAddress = this.tokenBaseAddress.getAndRequireEquals();

        const controllerTokenId = this.deriveTokenId();
        amountToBurn.assertGreaterThan(minBridgeBurnAmount, "Amount to burn must be greater than MIN_BRIDGE_AMOUNT");
        // maintain Storage
        let storage = new NoriStorageInterface(userAddress, controllerTokenId);
        // Require the storage account already exists (same reasoning as noriMint).
        storage.account.isNew.requireEquals(Bool(false));

        // record amount to be burned and capture the new cumulative burnedSoFar
        const newBurnedSoFar = await storage.addBurnGetCumulative(amountToBurn, receiver);

        // burn it
        let token = new FungibleToken(tokenAddress);
        await token.burn(userAddress, UInt64.fromFields(amountToBurn.toFields()));

        this.emitEvent("Burn", new BurnEvent({
            from: userAddress,
            amount: UInt64.fromFields(amountToBurn.toFields()),
            burnedSoFar: UInt64.fromFields(newBurnedSoFar.toFields()),
            receiverEth: receiver,
        }));

    }

    private async ensureAdminSignature() {
        const admin = await Provable.witnessAsync(PublicKey, async () => {
            let pk = await this.adminPublicKey.fetch();
            assert(pk !== undefined, 'could not fetch admin public key');
            return pk;
        });
        this.adminPublicKey.requireEquals(admin);
        return AccountUpdate.createSigned(admin);
    }
    /** 
     * Update the verification key.
     */
    @method
    async updateVerificationKey(vk: VerificationKey) {
        await this.ensureAdminSignature();
        this.account.verificationKey.set(vk);
    }

    @method async updateNoriHeliosProgramPi0(newPi0: FrC) {
        await this.ensureAdminSignature();
        this.noriHeliosProgramPi0.set(newPi0);
    }

    @method async updateProofConversionPO2(newPO2: Field) {
        await this.ensureAdminSignature();
        this.proofConversionPO2.set(newPO2);
    }

    @method async updateStoreHash(newStoreHash: Bytes32FieldPair) {
        await this.ensureAdminSignature();
        this.latestHeliusStoreInputHashHighByte.set(newStoreHash.highByteField);
        this.latestHeliusStoreInputHashLowerBytes.set(
            newStoreHash.lowerBytesField
        );
    }

    /**
     * Admin-only helper that dispatches a deposit root directly into the window,
     * bypassing update(). Exists for testing, to be deleted.
     */
    @method async adminSetDepositRoot(depositRoot: Field, oldestAction: Field) {
        await this.ensureAdminSignature();
        this.dispatchAndEvict(depositRoot, oldestAction);
    }

    /**
     * FungibleToken admin hook. Pass-through gate: noriMint clears mintLock
     * immediately before calling token.mint; this method consumes that
     * clearance and re-locks. Direct calls to FungibleToken.mint therefore
     * fail because mintLock remains true outside of an active noriMint.
     */
    @method.returns(Bool)
    public async canMint(_accountUpdate: AccountUpdate) {
        this.mintLock.requireEquals(Bool(false));
        this.mintLock.set(Bool(true));
        return Bool(true);
    }

    @method.returns(Bool)
    public async canChangeAdmin(_admin: PublicKey) {
        await this.ensureAdminSignature();
        return Bool(true);
    }

    @method.returns(Bool)
    public async canPause(): Promise<Bool> {
        await this.ensureAdminSignature();
        return Bool(true);
    }

    @method.returns(Bool)
    public async canResume(): Promise<Bool> {
        await this.ensureAdminSignature();
        return Bool(true);
    }

    @method.returns(Bool)
    public async canChangeVerificationKey(_vk: VerificationKey): Promise<Bool> {
        await this.ensureAdminSignature();
        return Bool(true);
    }
}
