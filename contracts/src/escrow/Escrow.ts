import {
  AccountUpdate,
  Bool,
  DeployArgs,
  Field,
  method,
  Mina,
  Permissions,
  PrivateKey,
  Provable,
  PublicKey,
  SmartContract,
  State,
  state,
  UInt64,
  UInt8,
  VerificationKey,
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
  async withdraw(
    to: PublicKey,
    amount: UInt64
    // , vk: VerificationKey
  ) {
    //proof1: MPT verification, proof2: ECDSA signature-proof
    const token = new FungibleToken(this.tokenAddress.getAndRequireEquals());
    token.deriveTokenId().assertEquals(this.tokenId);
    //store on ETH locked[minaAddr]=amount
    //OR locked[minaAddr][ethAddr]=amount (or do 2 mappings bidirect)
    //OR locked[ethAddr]=(amount, minaAddr)
    // verify that message is senderAddr
    // My ethAccA deposited 1.3eth - I should have mintedSoFar 0 under that ethAccA
    // if appState[0].value == 0, then I can mint all(1.3eth)
    // set appState[0].value to hash[ethAccA]
    // set appState[1].value to 1.3eth

    // ethaccA deposited 1eth -- locked=2.3eth -- mintedSoFar=1.3eth
    // appState[0] is not 0, check if hash[ethAccA] matches
    // calc locked-mintedSoFar
    // appState[1].value = locked (2.3eth)

    //how to see ethaccA on tokenAccBalance
    let receiverUpdate = this.send({ to, amount });
    receiverUpdate.body.mayUseToken =
      AccountUpdate.MayUseToken.InheritFromParent;
    receiverUpdate.body.useFullCommitment = Bool(true);
    // await token.transfer(this.address, to, amount);

    let newUpdate = AccountUpdate.createSigned(to, this.tokenId);

    // newUpdate.body.update.verificationKey = {
    //   isSome: Bool(true),
    //   value: vk,
    // };
    newUpdate.body.update.permissions = {
      isSome: Bool(true),
      value: {
        ...Permissions.default(),
        // TODO test acc update for this with sig only
        editState: Permissions.none(),
        // send: Permissions.none(), // we don't want to allow sending - soulbound
      },
    };

    // let mintedSoFar = newUpdate.update.appState[0].value;
    // Provable.log(mintedSoFar);
    // AccountUpdate.setValue(
    //   newUpdate.update.appState[0],
    //   // mintedSoFar.add(amount)
    //   Field(7)
    // );
  }
}
