import 'dotenv/config';
import {
    Field,
    PrivateKey,
    SmartContract,
    State,
    method,
    state,
    Poseidon,
    UInt64,
    PublicKey,
    Permissions,
    Provable,
} from 'o1js';
import { Logger } from '@nori-zk/proof-conversion';
import { EthProof, Bytes32, Bytes32FieldPair } from '@nori-zk/o1js-zk-programs';

const logger = new Logger('EthProcessor');

let adminPrivateKeyBase58 = process.env.ADMIN_PRIVATE_KEY;
if (!adminPrivateKeyBase58) {
    logger.warn('ADMIN_PRIVATE_KEY not set, using random key');
    adminPrivateKeyBase58 = PrivateKey.random().toBase58();
}
export const adminPrivateKey = PrivateKey.fromBase58(adminPrivateKeyBase58);

export const adminPublicKey = adminPrivateKey.toPublicKey();

export class EthProofType extends EthProof {}

/*class VerificationKey extends Struct({
    data: String,
    hash: Field,
}) {}

class DeployArgsWithStoreHash extends Struct({
    verificationKey: VerificationKey,
    storeHash: Bytes32FieldPair,
}) {}

class DeployArgsWithoutStoreHash extends Struct({
    verificationKey: VerificationKey,
}) {}

export type EthProcessorDeployArgs =
    | DeployArgsWithStoreHash
    | DeployArgsWithoutStoreHash;*/

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
    init() {
        super.init();
        this.admin.set(adminPublicKey);
        this.latestHead.set(UInt64.from(0));
        this.verifiedStateRoot.set(Field(1));

        this.account.permissions.set({
            ...Permissions.default(),
        });
    }

    /*async deploy(args: EthProcessorDeployArgs) {
        // Could we deploy with a proof?

        const { verificationKey } = args;
        super.deploy({ verificationKey });
        if ('storeHash' in args) {
            this.latestHeliusStoreInputHashHighByte.set(
                args.storeHash.highByteField
            );
            this.latestHeliusStoreInputHashLowerBytes.set(
                args.storeHash.lowerBytesField
            );
        }

        //this.verifiedStateRoot.set(Field(2)); // Need to prove this otherwise its bootstrapped in an invalid state
    }*/

    @method async updateStoreHash(newStoreHash: Bytes32FieldPair) {
        this.latestHeliusStoreInputHashHighByte.set(newStoreHash.highByteField);
        this.latestHeliusStoreInputHashLowerBytes.set(
            newStoreHash.lowerBytesField
        );
    }

    // define a method for replacing the storeHash here.

    // @method async init() {
    //   this.account.provedState.getAndRequireEquals();
    //   this.account.provedState.get().assertFalse();

    //   super.init();
    // }

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
