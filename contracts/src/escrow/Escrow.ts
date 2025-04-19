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
  Struct,
  TokenContract,
  UInt64,
  UInt8,
  VerificationKey,
} from 'o1js';
import { FungibleToken, FungibleTokenAdmin } from '../index.js';
import { EscrowStorage } from './EscrowStorage.js';

// export class MockMPTProof extends Struct({
//   lockedAmount: UInt64,
//   ethAddress: Field,
// }) {
//   async verify() {
//     return Bool(true);
//   }
// }

export class TokenEscrow extends SmartContract {
  @state(PublicKey) tokenAddress = State<PublicKey>();
  @state(PublicKey) owner = State<PublicKey>();

  async deploy(
    args: DeployArgs & { tokenAddress: PublicKey; owner: PublicKey }
  ) {
    await super.deploy(args);

    this.tokenAddress.set(args.tokenAddress);
    this.owner.set(args.owner);
    this.account.permissions.set({
      ...Permissions.default(),
      send: Permissions.proof(),
      // receive: Permissions.proof(),
      setVerificationKey:
        Permissions.VerificationKey.impossibleDuringCurrentVersion(),
      setPermissions: Permissions.impossible(),
    });
  }

  @method //admin only// todo why anyone can transfer no? change recive permissions?
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
    //what if someone send him a token, rather than withdrawing via us.
    //maybe have function to set
    let isNewAccount = new EscrowStorage(to, token.deriveTokenId()).account
      .isNew;
    isNewAccount.requireEquals(Bool(true));
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

    //why is this not the same as tokennAccUpdate
    let receiverUpdate = this.send({ to, amount });
    receiverUpdate.body.mayUseToken =
      AccountUpdate.MayUseToken.InheritFromParent;
    receiverUpdate.body.useFullCommitment = Bool(true);

    let tokenAccUpdate = AccountUpdate.createSigned(to, token.deriveTokenId());
    tokenAccUpdate.body.mayUseToken =
      AccountUpdate.MayUseToken.InheritFromParent;
    tokenAccUpdate.body.useFullCommitment = Bool(true);

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
      amount.value
      // Field(1)
    );
    this.approve(tokenAccUpdate);
  }

  @method //user only under proof validation
  async withdraw(to: PublicKey, totalAmountLockedOnEth: UInt64) {
    const token = new FungibleToken(this.tokenAddress.getAndRequireEquals());
    token.deriveTokenId().assertEquals(this.tokenId);

    let escrowStorage = new EscrowStorage(to, token.deriveTokenId());
    escrowStorage.account.isNew.requireEquals(Bool(false));
    // Provable.log(
    //   'escroVKINcontract?',
    //   escrowStorage.self.body.authorizationKind.verificationKeyHash
    // );
    // Provable.log(
    //   'update escroVKINcontract?',
    //   escrowStorage.self.update.verificationKey.value.hash
    // );
    //TODO need to validate not only if new, but that has correct vk an permissions
    //TODO above is impossible precondition in current protocol version
    let mintedSoFar = escrowStorage.mintedSoFar.getAndRequireEquals();
    // let amount = totalAmountLockedOnEth.sub(mintedSoFar);

    // let receiverUpdate = this.send({ to, amount });
    // receiverUpdate.body.mayUseToken =
    //   AccountUpdate.MayUseToken.InheritFromParent;
    // receiverUpdate.body.useFullCommitment = Bool(true);

    // let accUpdate =
    // await escrowStorage.setMintedSoFar(totalAmountLockedOnEth);
    // Provable.log('prooof:', accUpdate.authorization.proof);
    // Provable.log(
    //   'update vk hash:',
    //   accUpdate.update.verificationKey.value.hash
    // );
    // let accUpdate = AccountUpdate.create(to, token.deriveTokenId());

    // accUpdate.body.mayUseToken = AccountUpdate.MayUseToken.InheritFromParent;
    // AccountUpdate.setValue(
    //   receiverUpdate.update.appState[0],
    //   // mintedSoFar.add(amount)
    //   totalAmountLockedOnEth.value
    //   // Field(1)
    // );

    // this.self.body.mayUseToken = AccountUpdate.MayUseToken.InheritFromParent;

    // this.approve(receiverUpdate);
  }
  // @method.returns(AccountUpdate) async setMintedSoFar(
  //   to: PublicKey,
  //   totalAmountLockedOnEth: UInt64
  // ) {
  //   let tokenAccUpdate = AccountUpdate.createSigned(to, this.tokenId);
  //   AccountUpdate.setValue(
  //     tokenAccUpdate.update.appState[0],
  //     // mintedSoFar.add(amount)
  //     totalAmountLockedOnEth.value
  //     // Field(1)
  //   );
  //   return tokenAccUpdate;
  // }
}
