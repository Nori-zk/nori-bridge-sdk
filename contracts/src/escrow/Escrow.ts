import {
  AccountUpdate,
  Bool,
  DeployArgs,
  method,
  Mina,
  Permissions,
  PrivateKey,
  PublicKey,
  SmartContract,
  State,
  state,
  UInt64,
  UInt8,
} from 'o1js';
import { FungibleToken, FungibleTokenAdmin } from '../index.js';

export class TokenEscrow extends SmartContract {
  @state(PublicKey)
  tokenAddress = State<PublicKey>();
  @state(PublicKey)
  owner = State<PublicKey>();
  async deploy(
    args: DeployArgs & { tokenAddress: PublicKey; owner: PublicKey }
  ) {
    await super.deploy(args);

    this.tokenAddress.set(args.tokenAddress);
    this.owner.set(args.owner);
    this.account.permissions.set({
      ...Permissions.default(),
      send: Permissions.proof(),

      setVerificationKey:
        Permissions.VerificationKey.impossibleDuringCurrentVersion(),
      setPermissions: Permissions.impossible(),
    });
  }

  @method //admin only
  async deposit(amount: UInt64) {
    const token = new FungibleToken(this.tokenAddress.getAndRequireEquals());
    token.deriveTokenId().assertEquals(this.tokenId);

    const sender = this.sender.getUnconstrained();
    const senderUpdate = AccountUpdate.createSigned(sender);
    senderUpdate.body.useFullCommitment = Bool(true);
    this.owner.getAndRequireEquals().assertEquals(sender);

    await token.transfer(sender, this.address, amount);
  }

  @method //user only under proof validation
  async withdraw(to: PublicKey, amount: UInt64) {
    //proof1: MPT verification, proof2: ECDSA signature-proof
    const token = new FungibleToken(this.tokenAddress.getAndRequireEquals());
    token.deriveTokenId().assertEquals(this.tokenId);

    let receiverUpdate = this.send({ to, amount });
    receiverUpdate.body.mayUseToken =
      AccountUpdate.MayUseToken.InheritFromParent;
    receiverUpdate.body.useFullCommitment = Bool(true);

    // let mintedSoFar = receiverUpdate.update.appState[0].value;
    // AccountUpdate.setValue(
    //   receiverUpdate.update.appState[0],
    //   mintedSoFar.add(amount)
    // );
  }
}
