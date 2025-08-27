import {
    AccountUpdate,
    AccountUpdateForest,
    assert,
    Bool,
    Bytes,
    DeployArgs,
    Field,
    JsonProof,
    method,
    Permissions,
    Poseidon,
    Provable,
    PublicKey,
    SmartContract,
    State,
    state,
    Struct,
    TokenContract,
    UInt64,
    UInt8,
    VerificationKey,
} from 'o1js';
import { NoriStorageInterface } from './NoriStorageInterface.js';
import { FungibleToken } from './TokenBase.js';
import {
    FungibleTokenAdminBase,
    NoriTokenControllerDeployProps,
} from '../types.js';
import { ProvableEcdsaSigPresentation } from '../credentialAttestation.js';
import { Bytes20, EthProofType, Bytes32 } from '@nori-zk/o1js-zk-utils';
import { DynamicArray } from 'mina-attestations';

// ------- Deposit attestation ---------------------------------

export class ContractDeposit extends Struct({
    address: Bytes20.provable,
    attestationHash: Bytes32.provable,
    value: Bytes32.provable,
}) {}

const treeDepth = 16;

const MerklePath = DynamicArray(Field, { maxLength: treeDepth });

class MerkleTreeContractDepositAttestorInput extends Struct({
    rootHash: Field,
    path: MerklePath,
    index: UInt64,
    value: ContractDeposit,
}) {}

export function provableStorageSlotLeafHash(contractDeposit: ContractDeposit) {
    const addressBytes = contractDeposit.address.bytes; // UInt8[]
    const attestationHashBytes = contractDeposit.attestationHash.bytes; // UInt8[]
    const valueBytes = contractDeposit.value.bytes; // UInt8[]

    // We want 20 bytes from addrBytes (+ 1 byte from attBytes and 1 byte from valueBytes), remaining 31 bytes from attBytes, remaining 31 bytes from valueBytes

    // firstFieldBytes: 20 bytes from addressBytes + 1 byte from attBytes and 1 byte from valueBytes
    const firstFieldBytes: UInt8[] = [];

    for (let i = 0; i < 20; i++) {
        firstFieldBytes.push(addressBytes[i]);
    }
    firstFieldBytes.push(attestationHashBytes[0]);
    firstFieldBytes.push(valueBytes[0]);

    for (let i = 22; i < 32; i++) {
        firstFieldBytes.push(UInt8.zero); // static pad to 32
    }

    // secondFieldBytes: remaining 31 bytes from attBytes (1 to 31)
    const secondFieldBytes: UInt8[] = [];
    for (let i = 1; i < 32; i++) {
        secondFieldBytes.push(attestationHashBytes[i]);
    }

    // already 31 elements; add 1 zero to reach 32
    secondFieldBytes.push(UInt8.zero);

    // secondFieldBytes: remaining 31 bytes from valueBytes (1 to 31)
    const thirdFieldBytes: UInt8[] = [];
    for (let i = 1; i < 32; i++) {
        thirdFieldBytes.push(valueBytes[i]);
    }

    // already 31 elements; add 1 zero to reach 32
    thirdFieldBytes.push(UInt8.zero);

    // Convert UInt8[] to Bytes (provable bytes)
    const firstBytes = Bytes.from(firstFieldBytes);
    const secondBytes = Bytes.from(secondFieldBytes);
    const thirdBytes = Bytes.from(thirdFieldBytes);

    // Little endian
    let firstField = new Field(0);
    let secondField = new Field(0);
    let thirdField = new Field(0);
    for (let i = 31; i >= 0; i--) {
        firstField = firstField.mul(256).add(firstBytes.bytes[i].value);
        secondField = secondField.mul(256).add(secondBytes.bytes[i].value);
        thirdField = thirdField.mul(256).add(thirdBytes.bytes[i].value);
    }

    return Poseidon.hash([firstField, secondField, thirdField]);
}

function attestContractDeposit(input: MerkleTreeContractDepositAttestorInput) {
    let { index, path, rootHash } = input; // value

    let currentHash = provableStorageSlotLeafHash(input.value);

    const bitPath = index.value.toBits(path.maxLength);
    path.forEach((sibling, isDummy, i) => {
        const bit = bitPath[i];

        const left = Provable.if(bit, Field, sibling, currentHash);
        const right = Provable.if(bit, Field, currentHash, sibling);
        const nextHash = Poseidon.hash([left, right]);

        currentHash = Provable.if(isDummy, Field, currentHash, nextHash);
    });

    currentHash.assertEquals(rootHash);
    return currentHash;
}

// ----------------------- Verify deposit root ---------------------------
// merkleTreeContractDepositAttestorInput
function verifyDepositAttestationRoot(
    credentialAttestationHash: Field,
    merkleTreeContractDepositAttestorInput: MerkleTreeContractDepositAttestorInput,
    ethVerifierProof: EthProofType
) {
    const ethVerifierStorageProofRootBytes =
        ethVerifierProof.publicInput.verifiedContractDepositsRoot.bytes; // I think the is BE

    // Convert verifiedContractDepositsRoot from bytes to field
    let ethVerifierStorageProofRoot = new Field(0);
    // FIXME
    // Turn into a LE field?? This seems wierd as on the rust side we have fixed_bytes[..32].copy_from_slice(&root.to_bytes());
    // And here we re-interpret the BE as LE!
    // But it does pass the test! And otherwise fails.
    for (let i = 31; i >= 0; i--) {
        ethVerifierStorageProofRoot = ethVerifierStorageProofRoot
            .mul(256)
            .add(ethVerifierStorageProofRootBytes[i].value);
    }

    // Assert roots
    Provable.asProver(() => {
        Provable.log(
            'depositAttestationProofRoot',
            'ethVerifierStorageProofRoot',
            credentialAttestationHash,
            ethVerifierStorageProofRoot
        );
    });
    credentialAttestationHash.assertEquals(ethVerifierStorageProofRoot);

    // Mock attestation assert
    const contractDepositAttestorPublicInputs =
        merkleTreeContractDepositAttestorInput.value;
    // Convert contractDepositAttestorPublicInputs.attestationHash from bytes into a field
    const contractDepositAttestorProofCredentialBytes =
        contractDepositAttestorPublicInputs.attestationHash.bytes;
    let contractDepositAttestorProofCredential = new Field(0);
    // Turn into field
    for (let i = 0; i < 32; i++) {
        contractDepositAttestorProofCredential =
            contractDepositAttestorProofCredential
                .mul(256)
                .add(contractDepositAttestorProofCredentialBytes[i].value);
    }

    Provable.asProver(() => {
        Provable.log(
            'input.credentialAttestationHash',
            'contractDepositAttestorProofCredential',
            credentialAttestationHash,
            contractDepositAttestorProofCredential
        );
    });

    credentialAttestationHash.assertEquals(
        contractDepositAttestorProofCredential
    );

    Provable.asProver(() => {
        console.log(
            contractDepositAttestorPublicInputs.value.bytes.map((byte) =>
                byte.toBigInt()
            )
        );
    });

    // Turn totalLocked into a field
    const totalLockedBytes = contractDepositAttestorPublicInputs.value.bytes;
    let totalLocked = new Field(0);
    /*for (let i = 31; i >= 0; i--) {
                    totalLocked = totalLocked
                        .mul(256)
                        .add(totalLockedBytes[i].value);
                }*/
    for (let i = 0; i < 32; i++) {
        totalLocked = totalLocked.mul(256).add(totalLockedBytes[i].value);
    }

    // Perhaps flip this??
    // We interpret contractDepositAttestorProofCredential to BE so why not this??

    const storageDepositRoot = ethVerifierStorageProofRoot;
    const attestationHash = contractDepositAttestorProofCredential;

    return {
        totalLocked,
        storageDepositRoot,
        attestationHash,
    };
}

// ----------------------- Token Controller -------------------------------

export interface MintProofData {
    ethVerifierProof: EthProofType;
    presentationProof: ProvableEcdsaSigPresentation;
}

export interface MintProofDataJson {
    ethVerifierProofJson: JsonProof;
    presentationProofStr: string;
}

export class NoriTokenController
    extends TokenContract
    implements FungibleTokenAdminBase
{
    @state(PublicKey) adminPublicKey = State<PublicKey>();
    @state(PublicKey) tokenBaseAddress = State<PublicKey>();
    @state(PublicKey) ethProcessorAddress = State<PublicKey>();
    @state(Field) storageVKHash = State<Field>();
    @state(Bool) mintLock = State<Bool>();

    async deploy(props: NoriTokenControllerDeployProps) {
        await super.deploy(props);
        this.adminPublicKey.set(props.adminPublicKey);
        this.tokenBaseAddress.set(props.tokenBaseAddress);
        this.ethProcessorAddress.set(props.ethProcessorAddress);
        this.storageVKHash.set(props.storageVKHash);
        this.mintLock.set(Bool(true));
        this.account.permissions.set({
            ...Permissions.default(),
            setVerificationKey:
                Permissions.VerificationKey.impossibleDuringCurrentVersion(),
            setPermissions: Permissions.impossible(),
            editState: Permissions.proof(),
            send: Permissions.proof(),
        });
    }

    approveBase(forest: AccountUpdateForest): Promise<void> {
        throw Error('block updates');
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
        ethVerifierProof: EthProofType,
        presentationProof: ProvableEcdsaSigPresentation,
        merkleTreeContractDepositAttestorInput: MerkleTreeContractDepositAttestorInput
    ) {
        const userAddress = this.sender.getUnconstrained(); //TODO make user pass signature due to limit of AU
        const tokenAddress = this.tokenBaseAddress.getAndRequireEquals();

        // Validate presentation proof
        let { claims, outputClaim } = presentationProof.verify({
            publicKey: this.address,
            tokenId: this.tokenId,
            methodName: 'verifyPresentation', // TODO RENAME
        });

        // Validate eth verifier
        ethVerifierProof.verify();

        // Calculate the deposit slot root
        const contractDepositSlotRoot = attestContractDeposit(
            merkleTreeContractDepositAttestorInput
        );

        // Validate with eth verifier and extract values
        const ethDepositVerifiedData = verifyDepositAttestationRoot(contractDepositSlotRoot, merkleTreeContractDepositAttestorInput, ethVerifierProof);

        Provable.asProver(() => {
            Provable.log(
                'ethDepositProof.publicOutput.attestationHash',
                'outputClaim.messageHash',
                ethDepositVerifiedData.attestationHash,
                outputClaim.messageHash
            );
        });
        ethDepositVerifiedData.attestationHash.assertEquals(
            outputClaim.messageHash
        );

        //TODO when add ethProcessor
        // assert ethDepositProof.publicOutput.storageDepositRoot;

        const controllerTokenId = this.deriveTokenId();
        let storage = new NoriStorageInterface(userAddress, controllerTokenId);

        storage.account.isNew.requireEquals(Bool(false)); // that somehow allows to getState without index out of bounds
        storage.userKeyHash
            .getAndRequireEquals()
            .assertEquals(
                Poseidon.hash(userAddress.toFields()),
                ' userKeyHash mismatch'
            );

        // LHS e1 ->  s1 -> 1 RHS s1 + mpt + da .... 1 mint

        // LHS e1 -> s2 -> 1(2) RHS s2 + mpr + da .... want to mint 2.... total locked 1 claim (1).... cannot claim 2 because in this run we only deposited 1

        const amountToMint = await storage.increaseMintedAmount(
            ethDepositVerifiedData.totalLocked
        ); // TODO test mint amount is sane.
        Provable.log(amountToMint, 'amount to mint');

        // Here we have only one destination there is only m1.....
        let token = new FungibleToken(tokenAddress);
        this.mintLock.set(Bool(false));

        Provable.asProver(() => {
            console.log(
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
