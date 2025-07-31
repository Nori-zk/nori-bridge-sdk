import {
    AccountUpdate,
    AccountUpdateForest,
    assert,
    Bool,
    DeployArgs,
    Field,
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
    VerificationKey,
} from 'o1js';
import { NoriStorageInterface } from './NoriStorageInterface.js';
import { FungibleToken } from './TokenBase.js';
import {
    FungibleTokenAdminBase,
    NoriTokenControllerDeployProps,
} from './types.js';
import { EthDepositProgramProofType } from './e2ePrerequisites.js';
import { ProvableEcdsaSigPresentation } from './credentialAttestation.js';

export interface MintProofData {
    ethDepositProof: EthDepositProgramProofType,
    presentationProof: ProvableEcdsaSigPresentation
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
        ethDepositProof: EthDepositProgramProofType,
        presentationProof: ProvableEcdsaSigPresentation
    ) {
        const userAddress = this.sender.getUnconstrained(); //TODO make user pass signature due to limit of AU
        const tokenAddress = this.tokenBaseAddress.getAndRequireEquals();

        let { claims, outputClaim } = presentationProof.verify({
            publicKey: this.address,
            tokenId: this.tokenId,
            methodName: 'verifyPresentation', // TODO RENAME
        });

        Provable.asProver(() => {
            Provable.log(
                'ethDepositProof.publicOutput.attestationHash',
                'outputClaim.messageHash',
                ethDepositProof.publicOutput.attestationHash,
                outputClaim.messageHash
            );
        });
        ethDepositProof.publicOutput.attestationHash.assertEquals(
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
            ethDepositProof.publicOutput.totalLocked
        ); // TODO test mint amount is sane.
        Provable.log(amountToMint, 'amount to mint');

        // Here we have only one destination there is only m1.....
        let token = new FungibleToken(tokenAddress);
        this.mintLock.set(Bool(false));

        // Mint!
        await token.mint(
            userAddress,
            UInt64.Unsafe.fromField(amountToMint)
        );
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
