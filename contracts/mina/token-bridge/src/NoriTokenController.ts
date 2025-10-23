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
    TokenContract,
    UInt64,
    VerificationKey,
} from 'o1js';
import { NoriStorageInterface } from './NoriStorageInterface.js';
import { FungibleToken } from './TokenBase.js';
import { EthProofType } from '@nori-zk/o1js-zk-utils';
import {
    contractDepositCredentialAndTotalLockedToFields,
    getContractDepositSlotRootFromContractDepositAndWitness,
    MerkleTreeContractDepositAttestorInput,
    verifyDepositSlotRoot,
} from './depositAttestation.js';
import { verifyCodeChallenge } from './pkarm.js';

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

    /**
     * NOTE: MUST BE EMPTY, otherwise results in attacks. See `NoriStorageInterface` for reasons
     * @param forest 
     */
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
        //ethConsensusProof: MockConsenusProof,
        ethVerifierProof: EthProofType,
        merkleTreeContractDepositAttestorInput: MerkleTreeContractDepositAttestorInput,
        codeVerifierPKARM: Field
    ) {
        const userAddress = this.sender.getUnconstrained(); //TODO make user pass signature due to limit of AU
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

        storage.requireSignature();

        storage.account.isNew.requireEquals(Bool(false)); // that somehow allows to getState without index out of bounds
        storage.userKeyHash
            .getAndRequireEquals()
            .assertEquals(Poseidon.hash(userAddress.toFields()));

        storage.checkPermissionsValidity();

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
            console.log(
                'UInt64.Unsafe.fromField(amountToMint)',
                UInt64.Unsafe.fromField(amountToMint).toBigInt()
            );
        });

        // Mint!
        await token.mint(userAddress, UInt64.Unsafe.fromField(amountToMint));
    }

    /**
     *  This function directly mints nETH tokens, bypassing normal Ethereum deposit flow. It’s intended for testing, not production use.
     * @param amountToMint 
     */
    @method
    public async alignedMint(amountToMint: Field) {
        const userAddress = this.sender.getUnconstrained(); //TODO make user pass signature due to limit of AU
        const tokenAddress = this.tokenBaseAddress.getAndRequireEquals();

        // FOR TEST PURPOSE. Setting value here is intended for smoothly exec `canMint()` later.
        this.mintLock.set(Bool(false));

        let token = new FungibleToken(tokenAddress);

        const controllerTokenId = this.deriveTokenId();
        let storage = new NoriStorageInterface(userAddress, controllerTokenId);
        
        storage.requireSignature();

        storage.account.isNew.requireEquals(Bool(false)); // TODO ?? that somehow allows to getState without index out of bounds
        // storage.userKeyHash.getAndRequireEquals().assertEquals(Poseidon.hash(userAddress.toFields()));
        const _lockSoFar = storage.mintedSoFar.getAndRequireEquals().add(amountToMint);
        // TODO As a just test, do I need follow this manner to maintain `mintSoFar` with the cost of extra constraints?
        await storage.increaseMintedAmount(_lockSoFar);
        Provable.log(amountToMint, 'amount to mint');

        // Mint!
        await token.mint(userAddress, UInt64.Unsafe.fromField(amountToMint));
    }

    @method.returns(Bool)
    public async canMint(_accountUpdate: AccountUpdate) {
        const _mintLock = this.mintLock.getAndRequireEquals();
        _mintLock.assertEquals(Bool(false));

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
