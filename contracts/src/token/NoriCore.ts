import {
  AccountUpdate,
  AccountUpdateForest,
  assert,
  Bool,
  DeployArgs,
  Field,
  method,
  Mina,
  Permissions,
  Poseidon,
  PrivateKey,
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
import { EscrowStorage } from '../escrow/EscrowStorage.js';
import { FungibleToken } from './WETH.js';

export type FungibleTokenAdminBase = SmartContract & {
  canMint(accountUpdate: AccountUpdate): Promise<Bool>;
  canChangeAdmin(admin: PublicKey): Promise<Bool>;
  canPause(): Promise<Bool>;
  canResume(): Promise<Bool>;
  canChangeVerificationKey(vk: VerificationKey): Promise<Bool>;
};

export interface NoriCoreDeployProps extends Exclude<DeployArgs, undefined> {
  adminPublicKey: PublicKey;
}

export class NoriCore extends TokenContract implements FungibleTokenAdminBase {
  @state(PublicKey)
  private adminPublicKey = State<PublicKey>();

  async deploy(args: NoriCoreDeployProps) {
    await super.deploy(args);

    this.account.permissions.set({
      ...Permissions.default(),
      setVerificationKey:
        Permissions.VerificationKey.impossibleDuringCurrentVersion(),
      setPermissions: Permissions.impossible(),
      editState: Permissions.proof(),
      send: Permissions.proof(),
    });

    // this.vaultVerificationKeyHash.set(args.vaultVerificationKeyHash);
  }

  approveBase(forest: AccountUpdateForest): Promise<void> {
    throw Error('block updates');
  }

  @method async setUpStorage(
    to: PublicKey,
    vk: VerificationKey,
    tokenAddress: PublicKey
  ) {
    // const token = new FungibleToken(tokenAddress);
    // token.deriveTokenId().assertEquals(this.deriveTokenId());

    // let isNewAccount = new EscrowStorage(to, this.deriveTokenId()).account
    //   .isNew;
    // isNewAccount.requireEquals(Bool(true));

    // let receiverUpdate = this.send({ to, amount }); //maybe todo - send 1 and always ensure it's just 1?
    // receiverUpdate.body.mayUseToken =
    //   AccountUpdate.MayUseToken.InheritFromParent;
    // receiverUpdate.body.useFullCommitment = Bool(true);

    let tokenAccUpdate = AccountUpdate.createSigned(to, this.deriveTokenId());
    // tokenAccUpdate.body.mayUseToken =
    //   AccountUpdate.MayUseToken.InheritFromParent;
    // tokenAccUpdate.body.useFullCommitment = Bool(true);

    // this.approve(tokenAccUpdate);
    // this.
    // TODO assetEqual correct vk
    // this.account.verificationKey
    tokenAccUpdate.body.update.verificationKey = {
      isSome: Bool(true),
      value: vk,
    };
    tokenAccUpdate.body.update.permissions = {
      isSome: Bool(true),
      value: {
        ...Permissions.default(),
        // TODO test acc update for this with sig only
        editState: Permissions.proof(),
        // VK upgradability here?
        setVerificationKey:
          Permissions.VerificationKey.impossibleDuringCurrentVersion(),
        setPermissions: Permissions.proof(),
      },
    };

    // let mintedSoFar = tokenAccUpdate.update.appState[0].value;
    // Provable.log(mintedSoFar, 'mintedSoFar firstWithdraw');
    AccountUpdate.setValue(
      tokenAccUpdate.update.appState[0],
      // mintedSoFar.add(amount)
      // amount.value
      Poseidon.hash(to.toFields())
      // Field(1)
    );
  }

  /** Update the verification key.
   * Note that because we have set the permissions for setting the verification key to `impossibleDuringCurrentVersion()`, this will only be possible in case of a protocol update that requires an update.
   */
  @method
  async updateVerificationKey(vk: VerificationKey) {
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

  @method.returns(Bool)
  public async canMint(_accountUpdate: AccountUpdate) {
    // await this.ensureAdminSignature(); //todo
    const amount = _accountUpdate.body.balanceChange;
    Provable.log(amount, 'balance change');
    // Provable.log(_accountUpdate.body., 'balance change');

    // Provable.log('tokenId', _accountUpdate.tokenId);
    Provable.log('pubKey', _accountUpdate.publicKey);
    const noriCoreTokenId = this.deriveTokenId();
    Provable.log('noriCoreTokenId in canMint', noriCoreTokenId);
    let storage = new EscrowStorage(_accountUpdate.publicKey, noriCoreTokenId);
    // Provable.log(storage.mintedSoFar.getAndRequireEquals(), 'minted so far');
    let newUpdate = AccountUpdate.createSigned(
      _accountUpdate.publicKey,
      noriCoreTokenId
    );
    newUpdate.account.isNew.requireEquals(Bool(false));
    storage.userKeyHash
      .getAndRequireEquals()
      .assertEquals(Poseidon.hash(_accountUpdate.publicKey.toFields()));
    await storage.increaseMintedAmount(amount);
    // Provable.log(mintedSoFar, 'app state');
    // AccountUpdate.setValue(
    // _accountUpdate.update.appState[0],
    // mintedSoFar.add(amount)
    // Field(8)
    // );
    // _accountUpdate.body.update.permissions = {
    //   isSome: Bool(true),
    //   value: {
    //     ...Permissions.default(),
    //     // TODO test acc update for this with sig only
    //     editState: Permissions.proof(),
    //     // VK upgradability here?
    //     setVerificationKey:
    //       Permissions.VerificationKey.impossibleDuringCurrentVersion(),
    //     setPermissions: Permissions.impossible(),
    //   },
    // };
    // let newUpdate = AccountUpdate.createSigned(
    //   _accountUpdate.publicKey,
    //   _accountUpdate.tokenId
    // );
    // Provable.log('tokenId', _accountUpdate.tokenId);
    // Provable.log('pubKey', _accountUpdate.publicKey);

    // newUpdate.body.mayUseToken = AccountUpdate.MayUseToken.InheritFromParent;

    // this.approve(newUpdate);
    // TODO assetEqual correct vk
    // newUpdate.body.update.verificationKey = {
    //   isSome: Bool(true),
    //   value: vk,
    // };
    // newUpdate.body.update.permissions = {
    //   isSome: Bool(true),
    //   value: {
    //     ...Permissions.default(),
    //     // TODO test acc update for this with sig only
    //     editState: Permissions.proof(),
    //     // VK upgradability here?
    //     setVerificationKey:
    //       Permissions.VerificationKey.impossibleDuringCurrentVersion(),
    //     setPermissions: Permissions.impossible(),
    //   },
    // };

    // let mintedSoFar = newUpdate.update.appState[0].value;
    // Provable.log(mintedSoFar, 'mintedSoFar Admin');
    // AccountUpdate.setValue(
    //   newUpdate.update.appState[0],
    //   // mintedSoFar.add(amount)
    //   Field(6)
    // );
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
