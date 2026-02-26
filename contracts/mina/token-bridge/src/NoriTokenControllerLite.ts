import {
    AccountUpdate,
    assert,
    Bool,
    type DeployArgs,
    Field,
    method,
    Permissions,
    Poseidon,
    Provable,
    PublicKey,
    type SmartContract,
    State,
    state,
    TokenContract,
    UInt64,
} from 'o1js';
// VerificationKey and AccountUpdateForest must be value imports for @method decorator runtime validation
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { VerificationKey, AccountUpdateForest } from 'o1js';
import { Logger } from 'esm-iso-logger';
import { NoriStorageInterface } from './NoriStorageInterface.js';
import { FungibleToken } from './TokenBase.js';
// EthProofType must be a value import for @method decorator runtime validation
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { EthProofType, Bytes32FieldPair, Bytes32 } from '@nori-zk/o1js-zk-utils';
import {
    contractDepositCredentialAndTotalLockedToFields,
    getContractDepositSlotRootFromContractDepositAndWitness,
    verifyDepositSlotRoot,
} from './depositAttestation.js';
// MerkleTreeContractDepositAttestorInput must be a value import for @method decorator runtime validation
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { MerkleTreeContractDepositAttestorInput } from './depositAttestation.js';
import { verifyCodeChallenge } from './pkarm.js';

const logger = new Logger('NoriTokenControllerLite');

export type FungibleTokenAdminBase = SmartContract & {
    canMint(accountUpdate: AccountUpdate): Promise<Bool>;
    canChangeAdmin(admin: PublicKey): Promise<Bool>;
    canPause(): Promise<Bool>;
    canResume(): Promise<Bool>;
    canChangeVerificationKey(vk: VerificationKey): Promise<Bool>;
};

export interface NoriTokenControllerLiteDeployProps
    extends Exclude<DeployArgs, undefined> {
    adminPublicKey: PublicKey;
    tokenBaseAddress: PublicKey;
    storageVKHash: Field;
    initialStoreHash: Bytes32FieldPair;
}

/**
 * Experimental merge of NoriTokenController + EthProcessor concepts.
 * Keeps proof verification inside noriMint for fast iteration safety on Lightnet.
 */
export class NoriTokenControllerLite
    extends TokenContract
    implements FungibleTokenAdminBase
{
    @state(PublicKey) adminPublicKey = State<PublicKey>();
    @state(PublicKey) tokenBaseAddress = State<PublicKey>();
    @state(Field) storageVKHash = State<Field>();
    @state(Bool) mintLock = State<Bool>();

    // EthProcessor-like state
    @state(Field) verifiedStateRoot = State<Field>();
    @state(UInt64) latestHead = State<UInt64>();
    @state(Field) latestHeliusStoreInputHashHighByte = State<Field>();
    @state(Field) latestHeliusStoreInputHashLowerBytes = State<Field>();
    @state(Field) latestVerifiedContractDepositsRootHighByte = State<Field>();
    @state(Field) latestVerifiedContractDepositsRootLowerBytes = State<Field>();

    async deploy(props: NoriTokenControllerLiteDeployProps) {
        await super.deploy(props);
        this.adminPublicKey.set(props.adminPublicKey);
        this.tokenBaseAddress.set(props.tokenBaseAddress);
        this.storageVKHash.set(props.storageVKHash);
        this.mintLock.set(Bool(true));

        // Initial bridge state for local iteration.
        this.latestHead.set(UInt64.from(0));
        this.verifiedStateRoot.set(Field(1));
        this.latestHeliusStoreInputHashHighByte.set(
            props.initialStoreHash.highByteField
        );
        this.latestHeliusStoreInputHashLowerBytes.set(
            props.initialStoreHash.lowerBytesField
        );
        this.latestVerifiedContractDepositsRootHighByte.set(Field(0));
        this.latestVerifiedContractDepositsRootLowerBytes.set(Field(0));

        this.account.permissions.set({
            ...Permissions.default(),
            setVerificationKey:
                Permissions.VerificationKey.impossibleDuringCurrentVersion(),
            setPermissions: Permissions.impossible(),
            editState: Permissions.proof(),
            send: Permissions.proof(),
        });
    }

    approveBase(_forest: AccountUpdateForest): Promise<void> {
        throw Error('block updates');
    }

    @method async setUpStorage(user: PublicKey, vk: VerificationKey) {
        const tokenAccUpdate = AccountUpdate.createSigned(
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
                setVerificationKey:
                    Permissions.VerificationKey.impossibleDuringCurrentVersion(),
                setPermissions: Permissions.proof(),
            },
        };

        AccountUpdate.setValue(
            tokenAccUpdate.update.appState[0],
            Poseidon.hash(user.toFields())
        );
        AccountUpdate.setValue(tokenAccUpdate.update.appState[1], Field(0));
    }

    @method
    async updateVerificationKey(vk: VerificationKey) {
        await this.ensureAdminSignature();
        this.account.verificationKey.set(vk);
    }

    private async ensureAdminSignature() {
        const admin = await Provable.witnessAsync(PublicKey, async () => {
            const pk = await this.adminPublicKey.fetch();
            assert(pk !== undefined, 'could not fetch admin public key');
            return pk;
        });
        this.adminPublicKey.requireEquals(admin);
        return AccountUpdate.createSigned(admin);
    }

    @method async updateStoreHash(newStoreHash: Bytes32FieldPair) {
        await this.ensureAdminSignature();
        this.latestHeliusStoreInputHashHighByte.set(newStoreHash.highByteField);
        this.latestHeliusStoreInputHashLowerBytes.set(
            newStoreHash.lowerBytesField
        );
    }

    @method async update(ethProof: EthProofType) {
        const proofHead = ethProof.publicInput.outputSlot;
        const executionStateRoot = ethProof.publicInput.executionStateRoot;
        const currentSlot = this.latestHead.getAndRequireEquals();

        const newStoreHash = Bytes32FieldPair.fromBytes32(
            ethProof.publicInput.outputStoreHash
        );
        const prevStoreHash = Bytes32FieldPair.fromBytes32(
            ethProof.publicInput.inputStoreHash
        );

        prevStoreHash.highByteField.assertEquals(
            this.latestHeliusStoreInputHashHighByte.getAndRequireEquals(),
            "The latest transition proof input store hash high byte must match contract state."
        );
        prevStoreHash.lowerBytesField.assertEquals(
            this.latestHeliusStoreInputHashLowerBytes.getAndRequireEquals(),
            "The latest transition proof input store hash lower bytes must match contract state."
        );

        proofHead.assertGreaterThan(
            currentSlot,
            'Proof head must be greater than current head.'
        );

        // Guard against setting a zero next sync committee hash.
        let nextSyncCommitteeZeroAcc = new Field(0);
        for (let i = 0; i < 32; i++) {
            nextSyncCommitteeZeroAcc = nextSyncCommitteeZeroAcc.add(
                ethProof.publicInput.nextSyncCommitteeHash.bytes[i].value
            );
        }
        nextSyncCommitteeZeroAcc.assertNotEquals(new Field(0));

        ethProof.verify();

        const verifiedContractDepositsRoot = Bytes32FieldPair.fromBytes32(
            ethProof.publicInput.verifiedContractDepositsRoot
        );

        this.latestHead.set(proofHead);
        this.verifiedStateRoot.set(
            Poseidon.hashPacked(Bytes32.provable, executionStateRoot)
        );
        this.latestHeliusStoreInputHashHighByte.set(newStoreHash.highByteField);
        this.latestHeliusStoreInputHashLowerBytes.set(
            newStoreHash.lowerBytesField
        );
        this.latestVerifiedContractDepositsRootHighByte.set(
            verifiedContractDepositsRoot.highByteField
        );
        this.latestVerifiedContractDepositsRootLowerBytes.set(
            verifiedContractDepositsRoot.lowerBytesField
        );
    }

    @method public async noriMint(
        ethVerifierProof: EthProofType,
        merkleTreeContractDepositAttestorInput: MerkleTreeContractDepositAttestorInput,
        codeVerifierPKARM: Field
    ) {
        const userAddress = this.sender.getUnconstrained();
        const tokenAddress = this.tokenBaseAddress.getAndRequireEquals();

        // Keep proof verification in mint while iterating quickly.
        await ethVerifierProof.verify();

        const contractDepositSlotRoot =
            getContractDepositSlotRootFromContractDepositAndWitness(
                merkleTreeContractDepositAttestorInput
            );

        verifyDepositSlotRoot(contractDepositSlotRoot, ethVerifierProof);

        // Ensure mint proof root is aligned with latest bridge state that update() committed.
        const proofDepositsRoot = Bytes32FieldPair.fromBytes32(
            ethVerifierProof.publicInput.verifiedContractDepositsRoot
        );
        proofDepositsRoot.highByteField.assertEquals(
            this.latestVerifiedContractDepositsRootHighByte.getAndRequireEquals(),
            'Mint proof deposit root high byte is stale relative to latest update state.'
        );
        proofDepositsRoot.lowerBytesField.assertEquals(
            this.latestVerifiedContractDepositsRootLowerBytes.getAndRequireEquals(),
            'Mint proof deposit root lower bytes is stale relative to latest update state.'
        );

        const {
            totalLocked: totalLockedWei,
            attestationHash: codeChallengePKARM,
        } = contractDepositCredentialAndTotalLockedToFields(
            merkleTreeContractDepositAttestorInput
        );

        verifyCodeChallenge(codeVerifierPKARM, userAddress, codeChallengePKARM);

        const controllerTokenId = this.deriveTokenId();
        const storage = new NoriStorageInterface(userAddress, controllerTokenId);

        storage.account.isNew.requireEquals(Bool(false));
        storage.userKeyHash
            .getAndRequireEquals()
            .assertEquals(Poseidon.hash(userAddress.toFields()));

        totalLockedWei.assertGreaterThanOrEqual(
            new Field(1_000_000_000_000n),
            'Cannot mint: total locked wei is less than one bridge unit (1e12 wei required).'
        );

        const totalLockedBridgeUnits = totalLockedWei.div(
            new Field(1_000_000_000_000n)
        );

        const amountToMint = await storage.increaseMintedAmount(
            totalLockedBridgeUnits
        );
        Provable.log(amountToMint, 'amount to mint');

        const token = new FungibleToken(tokenAddress);
        this.mintLock.set(Bool(false));
        Provable.asProver(() => {
            logger.log(
                'UInt64.Unsafe.fromField(amountToMint)',
                UInt64.Unsafe.fromField(amountToMint).toBigInt()
            );
        });

        await token.mint(userAddress, UInt64.Unsafe.fromField(amountToMint));
    }

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
