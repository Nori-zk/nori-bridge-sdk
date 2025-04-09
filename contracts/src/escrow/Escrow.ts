import {
  AccountUpdate,
  AccountUpdateForest,
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
  TokenContract,
  UInt64,
  UInt8,
  VerificationKey,
} from 'o1js';
import { FungibleToken, FungibleTokenAdmin } from '../index.js';

export class TokenEscrow extends TokenContract {
  @state(PublicKey) tokenAddress = State<PublicKey>();
  @state(PublicKey) owner = State<PublicKey>();
  // @state(Field) vaultVerificationKeyHash = State<Field>();
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

  @method
  async approveBase(updates: AccountUpdateForest): Promise<void> {
    this.checkZeroBalanceChange(updates);
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
  async firstWithdraw(to: PublicKey, amount: UInt64, vk: VerificationKey) {
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

    // let newUpdate = await token.mint(to, amount);

    //how to see ethaccA on tokenAccBalance
    let receiverUpdate = this.send({ to, amount });
    receiverUpdate.body.mayUseToken =
      AccountUpdate.MayUseToken.InheritFromParent;
    receiverUpdate.body.useFullCommitment = Bool(true);
    // await token.transfer(this.address, to, amount);

    let newUpdate = AccountUpdate.createSigned(to, token.deriveTokenId());
    newUpdate.body.mayUseToken = AccountUpdate.MayUseToken.InheritFromParent;

    // this.approve(newUpdate);
    // TODO assetEqual correct vk
    newUpdate.body.update.verificationKey = {
      isSome: Bool(true),
      value: vk,
    };
    newUpdate.body.update.permissions = {
      isSome: Bool(true),
      value: {
        ...Permissions.default(),
        // TODO test acc update for this with sig only
        editState: Permissions.none(),
        // VK upgradability here?
        setVerificationKey:
          Permissions.VerificationKey.impossibleDuringCurrentVersion(),
        setPermissions: Permissions.proof(),
      },
    };

    // let mintedSoFar = newUpdate.update.appState[0].value;
    // Provable.log(mintedSoFar, 'mintedSoFar firstWithdraw');
    AccountUpdate.setValue(
      newUpdate.update.appState[0],
      // mintedSoFar.add(amount)
      Field(11)
    );
    this.approve(newUpdate);
  }

  @method //user only under proof validation
  async withdraw(to: PublicKey, amount: UInt64) {
    const token = new FungibleToken(this.tokenAddress.getAndRequireEquals());
    token.deriveTokenId().assertEquals(this.tokenId);

    let receiverUpdate = this.send({ to, amount });
    receiverUpdate.body.mayUseToken =
      AccountUpdate.MayUseToken.InheritFromParent;
    receiverUpdate.body.useFullCommitment = Bool(true);
    // await token.transfer(this.address, to, amount);

    let newUpdate = AccountUpdate.createSigned(to, token.deriveTokenId());
    newUpdate.body.mayUseToken = AccountUpdate.MayUseToken.InheritFromParent;
    // let mintedSoFar = newUpdate.update.appState[0].value;
    // Provable.log(mintedSoFar, 'mintedSoFar withdraw');
    AccountUpdate.setValue(
      newUpdate.update.appState[0],
      // mintedSoFar.add(amount)
      // mintedSoFar.add(Field(11))
      Field(99)
    );

    this.approve(newUpdate);
  }
}
