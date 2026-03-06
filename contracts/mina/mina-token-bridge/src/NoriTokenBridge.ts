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
import { EthInput, bytes32LEToFieldProvable } from '@nori-zk/o1js-zk-utils-new';
import {
    Bytes32,
    Bytes32FieldPair,
    bridgeHeadNoriSP1HeliosProgramPi0,
    proofConversionSP1ToPlonkPO2,
    proofConversionSP1ToPlonkVkData,
} from '@nori-zk/o1js-zk-utils-new';
import { Logger } from 'esm-iso-logger';
import { NoriStorageInterface } from './NoriStorageInterface.js';
import { FungibleToken } from './TokenBase.js';
import {
    contractDepositCredentialAndTotalLockedToFields,
    getContractDepositSlotRootFromContractDepositAndWitness,
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

export interface NoriTokenControllerDeployProps extends Exclude<
    DeployArgs,
    undefined
> {
    adminPublicKey: PublicKey;
    tokenBaseAddress: PublicKey;
    storageVKHash: Field;
    newStoreHash: Bytes32FieldPair;
}

export class NoriTokenBridge
    extends TokenContract
    implements FungibleTokenAdminBase
{
    @state(PublicKey) adminPublicKey = State<PublicKey>();
    @state(PublicKey) tokenBaseAddress = State<PublicKey>();
    @state(Field) storageVKHash = State<Field>();
    @state(Bool) mintLock = State<Bool>();

    @state(Field) verifiedStateRoot = State<Field>(); // todo make PackedString
    @state(UInt64) latestHead = State<UInt64>();
    @state(Field) latestHeliusStoreInputHashHighByte = State<Field>();
    @state(Field) latestHeliusStoreInputHashLowerBytes = State<Field>();
    @state(Field) latestVerifiedContractDepositsRoot = State<Field>(); // 2 + 2 + 7 = 11

    @state(Field) counter = State<Field>();
    private counterMod = new Field(16);
    @state(Field) depositRoot0 = State<Field>();
    @state(Field) depositRoot1 = State<Field>();
    @state(Field) depositRoot2 = State<Field>();
    @state(Field) depositRoot3 = State<Field>();
    @state(Field) depositRoot4 = State<Field>();
    @state(Field) depositRoot5 = State<Field>();
    @state(Field) depositRoot6 = State<Field>();
    @state(Field) depositRoot7 = State<Field>();
    @state(Field) depositRoot8 = State<Field>();
    @state(Field) depositRoot9 = State<Field>();
    @state(Field) depositRoot10 = State<Field>();
    @state(Field) depositRoot11 = State<Field>();
    @state(Field) depositRoot12 = State<Field>();
    @state(Field) depositRoot13 = State<Field>();
    @state(Field) depositRoot14 = State<Field>(); // 27
    @state(Field) depositRoot15 = State<Field>();

    private windowOfSlots() {
        return [
            this.depositRoot0,
            this.depositRoot1,
            this.depositRoot2,
            this.depositRoot3,
            this.depositRoot4,
            this.depositRoot5,
            this.depositRoot6,
            this.depositRoot7,
            this.depositRoot8,
            this.depositRoot9,
            this.depositRoot10,
            this.depositRoot11,
            this.depositRoot12,
            this.depositRoot13,
            this.depositRoot14,
            this.depositRoot15,
        ];
    }

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
            setVerificationKey: Permissions.VerificationKey.proofOrSignature(),
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
        this.latestHeliusStoreInputHashHighByte.set(
            props.newStoreHash.highByteField
        );
        this.latestHeliusStoreInputHashLowerBytes.set(
            props.newStoreHash.lowerBytesField
        );
    }

    approveBase(_forest: AccountUpdateForest): Promise<void> {
        throw Error('block updates');
    }

    private ethVerify(input: EthInput, proof: NodeProofLeft) {
        // JK to swap in CI after contract gets updated and redeployed

        // This is an sp1Proof.proof.Plonk.public_inputs[0]
        // This can now be extracted from bridge head repo at location
        // nori-elf/nori-sp1-helios-program.pi0.json and should be copied to this repository
        const ethPlonkVK = FrC.from(bridgeHeadNoriSP1HeliosProgramPi0);

        // p0 = proofConversionOutput.proofData.publicOutput[2] // hash of publicOutput of sp1
        const ethNodeVk = Field.from(proofConversionSP1ToPlonkPO2);

        // Verification of proof conversion
        // vk = proofConversionOutput.vkData
        // this is also from nodeVK
        const vk = VerificationKey.fromJSON(proofConversionSP1ToPlonkVkData);

        // [zkProgram / circuit][eth processor /  contract ie on-chain state]

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

        // Check that zkprograminput is same as passed to the SP1 program
        const pi0 = ethPlonkVK; // It might be helpful for debugging to assert this seperately.
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
    }

    @method async update(input: EthInput, proof: NodeProofLeft) {
        // Verify transition proof.
        this.ethVerify(input, proof);
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

        // Verification of slot progress. Moved to the bottom to allow us to test hash mismatches do indeed yield validation errors.
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

        // Set verifiedContractDepositsRootField into window of slots
        let counter = this.counter.getAndRequireEquals();
        const windowOfSlots = this.windowOfSlots();

        // INSERT NON SILLY METHOD HERE
        // const accountUpdate = AccountUpdate.create(this.address);
        // for (let i = 0; i < 16; i++) {
        //     const index = new Field(i);
        //     const slot = windowOfSlots[i];
        //     const slotValue = slot.getAndRequireEquals();
        //     const newSlotValue = Provable.if(
        //         index.equals(counter),
        //         Field,
        //         verifiedContractDepositsRootField,
        //         slotValue
        //     );
        //     AccountUpdate.setValue(accountUpdate.body.update.appState[i], newSlotValue);
        // }
        // JK GUESS
        for (let i = 0; i < 16; i++) {
            const index = new Field(i);
            const slot = windowOfSlots[i];
            const slotValue = slot.getAndRequireEquals();
            const newSlotValue = Provable.if(
                index.equals(counter),
                Field,
                verifiedContractDepositsRootField,
                slotValue
            );
            slot.set(newSlotValue);
        }

        counter = counter.add(1);
        counter = Provable.if(counter.greaterThanOrEqual(this.counterMod), new Field(0), counter);
        this.counter.set(counter);
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
        // ethVerifierProof: EthProofType,
        merkleTreeContractDepositAttestorInput: MerkleTreeContractDepositAttestorInput,
        codeVerifierPKARM: Field
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

        // assert that the root from the above was previously stored as the latest verified contract deposits root
        // TODO from stored Bytes32FieldPair into Bytes32 and then into Bytes ?
        // this.latestVerifiedContractDepositsRootHighByte.getAndRequireEquals().assertEquals(
        //     Bytes32FieldPair.to
        //     contractDepositSlotRoot.highByteField.
        // )
        // const highByteField = this.latestVerifiedContractDepositsRootHighByte.getAndRequireEquals();
        // const lowerBytesField = this.latestVerifiedContractDepositsRootLowerBytes.getAndRequireEquals();
        // const storedVerifiedContractDepositsRoot = bytes32FieldPairToBytes32(
        //    highByteField,
        //    lowerBytesField);
        const storedVerifiedContractDepositsRoot =
            this.latestVerifiedContractDepositsRoot.getAndRequireEquals();

        storedVerifiedContractDepositsRoot.assertEquals(
            contractDepositSlotRoot,
            'The provided contract deposit and witness do not yield the latest verified contract deposits root, and thus cannot be used to mint.'
        );

        // Bytes32FieldPair
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
        const totalLockedBridgeUnits = totalLockedWei.div(
            new Field(1_000_000_000_000n)
        );
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
