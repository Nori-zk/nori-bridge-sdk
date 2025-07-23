import {
    Field,
    SmartContract,
    State,
    method,
    state,
    Poseidon,
    UInt64,
    PublicKey,
    Permissions,
    Provable,
    VerificationKey,
    assert,
    AccountUpdate,
} from 'o1js';
import { EthProof, Bytes32, Bytes32FieldPair } from '@nori-zk/o1js-zk-utils';

export class EthProofType extends EthProof {}

export class EthProcessor extends SmartContract {
    @state(PublicKey) admin = State<PublicKey>();
    @state(Field) verifiedStateRoot = State<Field>(); // todo make PackedString
    @state(UInt64) latestHead = State<UInt64>();
    @state(Field) latestHeliusStoreInputHashHighByte = State<Field>();
    @state(Field) latestHeliusStoreInputHashLowerBytes = State<Field>();
    @state(Field) latestVerifiedContractDepositsRootHighByte = State<Field>();
    @state(Field) latestVerifiedContractDepositsRootLowerBytes = State<Field>();

    //todo
    // events = { 'executionStateRoot-set': Bytes32.provable };//todo change type, if events even possible

    init(): void {
        // Init smart contract state (all zeros)
        super.init();
        // Set account permissions
        this.account.permissions.set({
            ...Permissions.default(),
            // Allow VK updates
            setVerificationKey:
                Permissions.VerificationKey.proofDuringCurrentVersion(),
        });
    }

    private async ensureAdminSignature() {
        const admin = await Provable.witnessAsync(PublicKey, async () => {
            let pk = await this.admin.fetch();
            assert(pk !== undefined, 'could not fetch admin public key');
            return pk;
        });
        Provable.asProver(() => {
            Provable.log('ensureAdminSignature', this.admin.get().toBase58(), admin.toBase58());
        });
        this.admin.requireEquals(admin);
        return AccountUpdate.createSigned(admin);
    }

    @method async setVerificationKey(vk: VerificationKey) {
        await this.ensureAdminSignature();
        this.account.verificationKey.set(vk);
    }

    @method async initialize(
        adminPublicKey: PublicKey,
        newStoreHash: Bytes32FieldPair
    ) {
        const isInitialized = this.account.provedState.getAndRequireEquals();
        isInitialized.assertFalse('EthProcessor has already been initialized!');

        this.admin.set(adminPublicKey);

        // Set initial state (TODO set these to real values!)
        this.latestHead.set(UInt64.from(0));
        this.verifiedStateRoot.set(Field(1));
        // Set inital state of store hash.
        // await this.updateStoreHash(newStoreHash); // Reintroduce this instead of the immediate below when we can
        // verify that this.admin.getAndRequireEquals() == adminPublicKey immediately after this.admin.set(adminPublicKey);
        this.latestHeliusStoreInputHashHighByte.set(newStoreHash.highByteField);
        this.latestHeliusStoreInputHashLowerBytes.set(
            newStoreHash.lowerBytesField
        );
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
}
