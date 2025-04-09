import {
  AccountUpdate,
  assert,
  Bool,
  DeployArgs,
  Field,
  method,
  Permissions,
  Provable,
  PublicKey,
  SmartContract,
  State,
  state,
  VerificationKey,
} from 'o1js';

import { EscrowStorage } from '../escrow/EscrowStorage.js';

export type FungibleTokenAdminBase = SmartContract & {
  canMint(accountUpdate: AccountUpdate): Promise<Bool>;
  canChangeAdmin(admin: PublicKey): Promise<Bool>;
  canPause(): Promise<Bool>;
  canResume(): Promise<Bool>;
  canChangeVerificationKey(vk: VerificationKey): Promise<Bool>;
};

export interface FungibleTokenAdminDeployProps
  extends Exclude<DeployArgs, undefined> {
  adminPublicKey: PublicKey;
}

/** A contract that grants permissions for administrative actions on a token.
 *
 * We separate this out into a dedicated contract. That way, when issuing a token, a user can
 * specify their own rules for administrative actions, without changing the token contract itself.
 *
 * The advantage is that third party applications that only use the token in a non-privileged way
 * can integrate against the unchanged token contract.
 */
export class FungibleTokenAdmin
  extends SmartContract
  implements FungibleTokenAdminBase
{
  @state(PublicKey)
  private adminPublicKey = State<PublicKey>();

  async deploy(props: FungibleTokenAdminDeployProps) {
    await super.deploy(props);
    this.adminPublicKey.set(props.adminPublicKey);
    this.account.permissions.set({
      ...Permissions.default(),
      setVerificationKey:
        Permissions.VerificationKey.impossibleDuringCurrentVersion(),
      setPermissions: Permissions.impossible(),
    });
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
    // await this.ensureAdminSignature();
    // Provable.log(_accountUpdate.body.balanceChange, 'balance change');
    // Provable.log('tokenId', _accountUpdate.tokenId);
    // Provable.log('pubKey', _accountUpdate.publicKey);
    // let storage = new EscrowStorage(
    //   _accountUpdate.publicKey,
    //   _accountUpdate.tokenId
    // );
    // Provable.log(storage.mintedSoFar.get(), 'minted so far');
    // let newUpdate = AccountUpdate.createSigned(
    //   _accountUpdate.publicKey,
    //   _accountUpdate.tokenId
    // );
    // let mintedSoFar = newUpdate.update.appState[0].value;
    // Provable.log(_accountUpdate.update.appState[0], 'app state');
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
