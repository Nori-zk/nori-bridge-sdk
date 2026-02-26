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
} from 'o1js';
// VerificationKey must be a value import for @method decorator runtime validation
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { VerificationKey, AccountUpdateForest } from 'o1js';
import { EthProof, Bytes32, Bytes32FieldPair, EthProofType } from '@nori-zk/o1js-zk-utils';
import { Logger } from 'esm-iso-logger';
import { NoriStorageInterface } from './NoriStorageInterface.js';
import { FungibleToken } from './TokenBase.js';
import {
    contractDepositCredentialAndTotalLockedToFields,
    getContractDepositSlotRootFromContractDepositAndWitness,
    verifyDepositSlotRoot,
} from './depositAttestation.js';
// MerkleTreeContractDepositAttestorInput must be a value import for @method decorator runtime validation
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { MerkleTreeContractDepositAttestorInput } from './depositAttestation.js';
import { verifyCodeChallenge } from './pkarm.js';


const logger = new Logger('NoriTokenController');

export type FungibleTokenAdminBase = SmartContract & {
    canMint(accountUpdate: AccountUpdate): Promise<Bool>;
    canChangeAdmin(admin: PublicKey): Promise<Bool>;
    canPause(): Promise<Bool>;
    canResume(): Promise<Bool>;
    canChangeVerificationKey(vk: VerificationKey): Promise<Bool>;
};

export interface NoriTokenControllerDeployProps
    extends Exclude<DeployArgs, undefined> {
    adminPublicKey: PublicKey;
    tokenBaseAddress: PublicKey;
    ethProcessorAddress: PublicKey;
    storageVKHash: Field;
    newStoreHash: Bytes32FieldPair;
}

export class NoriTokenBridge
    extends TokenContract
    implements FungibleTokenAdminBase {
    @state(PublicKey) adminPublicKey = State<PublicKey>();
    @state(PublicKey) tokenBaseAddress = State<PublicKey>();
    @state(Field) storageVKHash = State<Field>();
    @state(Bool) mintLock = State<Bool>();

    @state(Field) verifiedStateRoot = State<Field>(); // todo make PackedString
    @state(UInt64) latestHead = State<UInt64>();
    @state(Field) latestHeliusStoreInputHashHighByte = State<Field>();
    @state(Field) latestHeliusStoreInputHashLowerBytes = State<Field>();
    @state(Field) latestVerifiedContractDepositsRootHighByte = State<Field>();
    @state(Field) latestVerifiedContractDepositsRootLowerBytes = State<Field>();


    //todo
    // events = { 'executionStateRoot-set': Bytes32.provable };//todo change type, if events even possible


    async deploy(props: NoriTokenControllerDeployProps) {
        await super.deploy(props);
        this.adminPublicKey.set(props.adminPublicKey);
        this.tokenBaseAddress.set(props.tokenBaseAddress);
        this.storageVKHash.set(props.storageVKHash);
        this.mintLock.set(Bool(true));
        this.account.permissions.set({
            ...Permissions.default(),
            setVerificationKey:
                Permissions.VerificationKey.proofOrSignature(),
            setPermissions: Permissions.impossible(),
            editState: Permissions.proof(),
            send: Permissions.proof(),
        });
        const isInitialized = this.account.provedState.getAndRequireEquals();
        isInitialized.assertFalse('EthProcessor has already been initialized!');

        // Set initial state (TODO set these to real values!)
        this.latestHead.set(UInt64.from(0));
        this.verifiedStateRoot.set(Field(1));
        // Set inital state of store hash.
        // await this.updateStoreHash(newStoreHash); // Reintroduce this instead of the immediate below when we can
        // verify that this.admin.getAndRequireEquals() == adminPublicKey immediately after this.admin.set(adminPublicKey);
        this.latestHeliusStoreInputHashHighByte.set(props.newStoreHash.highByteField);
        this.latestHeliusStoreInputHashLowerBytes.set(
            props.newStoreHash.lowerBytesField
        );
    }

    approveBase(_forest: AccountUpdateForest): Promise<void> {
        throw Error('block updates');
    }

    @method async update(ethProof: EthProofType) {
        const proofHead = ethProof.publicInput.outputSlot;
        const executionStateRoot = ethProof.publicInput.executionStateRoot;
        const currentSlot = this.latestHead.getAndRequireEquals();

        const newStoreHash = Bytes32FieldPair.fromBytes32(
            ethProof.publicInput.outputStoreHash
        );

        Provable.asProver(() => {
            Provable.log('Proof input store hash values were:');
            Provable.log(ethProof.publicInput.outputStoreHash.bytes[0].value);
            Provable.log(
                ethProof.publicInput.outputStoreHash.bytes
                    .slice(1, 33)
                    .map((b) => b.value)
            );
            Provable.log(
                'Public outputs created:',
                newStoreHash.highByteField,
                newStoreHash.lowerBytesField
            );
        });

        Provable.asProver(() => {
            Provable.log('Current slot', currentSlot);
        });

        const prevStoreHash = Bytes32FieldPair.fromBytes32(
            ethProof.publicInput.inputStoreHash
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

        // Verification of slot progress. Moved to the bottom to allow us to test hash mismatches do indeed yield validation errors.
        proofHead.assertGreaterThan(
            currentSlot,
            'Proof head must be greater than current head.'
        );

        // Verification that next sync commitee is non zero (could brick the bridge head otherwise)
        let nextSyncCommitteeZeroAcc = new Field(0);
        for (let i = 0; i < 32; i++) {
            nextSyncCommitteeZeroAcc = nextSyncCommitteeZeroAcc.add(
                ethProof.publicInput.nextSyncCommitteeHash.bytes[i].value
            );
        }
        nextSyncCommitteeZeroAcc.assertNotEquals(new Field(0));

        // Verify transition proof.
        ethProof.verify();

        // Pack the verifiedContractDepositsRoot into a pair of fields
        const verifiedContractDepositsRoot = Bytes32FieldPair.fromBytes32(
            ethProof.publicInput.verifiedContractDepositsRoot
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
        this.latestVerifiedContractDepositsRootHighByte.set(
            verifiedContractDepositsRoot.highByteField
        );
        this.latestVerifiedContractDepositsRootLowerBytes.set(
            verifiedContractDepositsRoot.lowerBytesField
        );
    }

    @method async setUpStorage(user: PublicKey, vk: VerificationKey) {
        let tokenAccUpdate = AccountUpdate.createSigned(
            user,
            this.deriveTokenId()
        );
        // TODO: what if someone sent token to this address before?
        tokenAccUpdate.account.isNew.requireEquals(Bool(true));

        // could use the idea of vkMap from latest standard
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
    /** Update the verification key.
     */
    @method
    async updateVerificationKey(vk: VerificationKey) {
        await this.ensureAdminSignature();
        this.account.verificationKey.set(vk);
    }

    @method async updateStoreHash(newStoreHash: Bytes32FieldPair) {
        await this.ensureAdminSignature();
        this.latestHeliusStoreInputHashHighByte.set(newStoreHash.highByteField);
        this.latestHeliusStoreInputHashLowerBytes.set(
            newStoreHash.lowerBytesField
        );
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

    @method public async noriMint(
        //ethConsensusProof: MockConsenusProof,
        ethVerifierProof: EthProofType,
        merkleTreeContractDepositAttestorInput: MerkleTreeContractDepositAttestorInput,
        codeVerifierPKARM: Field
    ) {
        const userAddress = this.sender.getAndRequireSignature();
        const tokenAddress = this.tokenBaseAddress.getAndRequireEquals();

        // Verify consensus transition mpt proof
        await ethVerifierProof.verify();

        // Calculate the deposit slot root
        // This just proves that the index and value with the witness yield a root
        // Aka some value exists at some index and yields a certain root
        const contractDepositSlotRoot =
            getContractDepositSlotRootFromContractDepositAndWitness(
                merkleTreeContractDepositAttestorInput
            );

        // Validates that the generated root and the contractDepositSlotRoot within the eth proof match.
        verifyDepositSlotRoot(contractDepositSlotRoot, ethVerifierProof);

        // Extract out the contract deposit credential and the tokens locked from the merkle merkleTreeContractDepositAttestorInput as fields
        const {
            totalLocked: totalLockedWei,
            attestationHash: codeChallengePKARM,
        } = contractDepositCredentialAndTotalLockedToFields(
            merkleTreeContractDepositAttestorInput
        );

        // Verify the code challenge
        verifyCodeChallenge(codeVerifierPKARM, userAddress, codeChallengePKARM);

        // Construct storage interface
        const controllerTokenId = this.deriveTokenId();
        let storage = new NoriStorageInterface(userAddress, controllerTokenId);

        storage.account.isNew.requireEquals(Bool(false)); // that somehow allows to getState without index out of bounds
        storage.userKeyHash
            .getAndRequireEquals()
            .assertEquals(Poseidon.hash(userAddress.toFields()));

        // LHS e1 ->  s1 -> 1 RHS s1 + mpt + da .... 1 mint

        // LHS e1 -> s2 -> 1(2) RHS s2 + mpr + da .... want to mint 2.... total locked 1 claim (1).... cannot claim 2 because in this run we only deposited 1

        // Ensure totalLockedWei is at least one bridge unit
        totalLockedWei.assertGreaterThanOrEqual(
            new Field(1_000_000_000_000n),
            'Cannot mint: total locked wei is less than one bridge unit (atleast 1e12 wei is needed)'
        );

        // Convert totalLockedWei to bridge units
        // Divide by number bridge scale factor, we have min deposit of 1e-6 ETH (6dp) and 1 ETH is 1e18 wei
        // So factor is 18-6=12 1e12
        const totalLockedBridgeUnits = totalLockedWei.div(new Field(1_000_000_000_000n));
        /*const totalLockedBridgeUnits = Provable.witness(
            Field,
            () => new Field(totalLockedWei.toBigInt() / 1_000_000_000_000n)
        );
        totalLockedBridgeUnits.mul(new Field(1_000_000_000_000n)).assertEquals(totalLockedWei);*/


        // Derive amount to mint based of the total locked so far.
        const amountToMint = await storage.increaseMintedAmount(
            totalLockedBridgeUnits
        );
        Provable.log(amountToMint, 'amount to mint');

        // Here we have only one destination there is only m1.....
        let token = new FungibleToken(tokenAddress);
        this.mintLock.set(Bool(false));
        Provable.asProver(() => {
            logger.log(
                'UInt64.Unsafe.fromField(amountToMint)',
                UInt64.Unsafe.fromField(amountToMint).toBigInt()
            );
        });

        // Mint!
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