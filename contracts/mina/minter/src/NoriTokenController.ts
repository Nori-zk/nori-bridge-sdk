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
export class MockConsenusProof extends Struct({
  storeHash: Field,
  attesterRoot: Field,
}) {
  async verify() {
    return Bool(true);
  }
}

export class MockDepositAttesterProof extends Struct({
  attesterRoot: Field,
  minaAttestHash: Field,
  lockedSoFar: Field,
}) {
  async verify() {
    return Bool(true);
  }
}
export class MockMinaAttestationProof extends Struct({
  proof: Field,
}) {
  async verify() {
    return Bool(true);
  }
  async hash() {
    return Poseidon.hash([this.proof]);
  }
}
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
  storageVKHash: Field;
}

export class NoriTokenController
  extends TokenContract
  implements FungibleTokenAdminBase
{
  @state(PublicKey) adminPublicKey = State<PublicKey>();
  @state(PublicKey) tokenBaseAddress = State<PublicKey>();
  @state(Field) storageVKHash = State<Field>();
  @state(Bool) mintLock = State<Bool>();

  async deploy(props: NoriTokenControllerDeployProps) {
    await super.deploy(props);
    this.adminPublicKey.set(props.adminPublicKey);
    this.tokenBaseAddress.set(props.tokenBaseAddress);
    this.storageVKHash.set(props.storageVKHash);
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
    let tokenAccUpdate = AccountUpdate.createSigned(user, this.deriveTokenId());
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
    ethConsensusProof: MockConsenusProof,
    depositAttesterProof: MockDepositAttesterProof,
    minaAttestationProof: MockMinaAttestationProof
  ) {
    const userAddress = this.sender.getUnconstrained(); //TODO make user pass signature due to limit of AU
    const tokenAddress = this.tokenBaseAddress.getAndRequireEquals();
    await ethConsensusProof.verify();
    await depositAttesterProof.verify();
    await minaAttestationProof.verify();
    //TODO when add ethProcessor
    // ethConsensusProof.storeHash.assertEquals(ethProcessor.storeHash);
    depositAttesterProof.attesterRoot.assertEquals(
      ethConsensusProof.attesterRoot
    );
    depositAttesterProof.minaAttestHash.assertEquals(
      await minaAttestationProof.hash()
    );
    const controllerTokenId = this.deriveTokenId();
    let storage = new NoriStorageInterface(userAddress, controllerTokenId);

    storage.account.isNew.requireEquals(Bool(false)); // that somehow allows to getState without index out of bounds
    storage.userKeyHash
      .getAndRequireEquals()
      .assertEquals(Poseidon.hash(userAddress.toFields()));

    const amountToMint = await storage.increaseMintedAmount(
      depositAttesterProof.lockedSoFar
    );
    // Provable.log(amountToMint, 'amount to mint');

    let token = new FungibleToken(tokenAddress);
    this.mintLock.set(Bool(false));
    await token.mint(userAddress, UInt64.Unsafe.fromField(amountToMint));
  }

  @method.returns(Bool)
  public async canMint(_accountUpdate: AccountUpdate) {
    // const amount = _accountUpdate.body.balanceChange;
    // Provable.log(amount, 'balance change in canMint');
    this.mintLock.getAndRequireEquals().assertEquals(Bool(false));
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
