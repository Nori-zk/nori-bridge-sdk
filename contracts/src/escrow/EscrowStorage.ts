import {
  Field,
  SmartContract,
  state,
  State,
  Bool,
  UInt32,
  UInt64,
  method,
  AccountUpdate,
  Provable,
} from 'o1js';

/** Stores  */
export class EscrowStorage extends SmartContract {
  @state(UInt64) mintedSoFar = State<UInt64>();

  @method async mock() {
    Field(1).assertEquals(Field(1));
  }
  @method.returns(AccountUpdate) async setMintedSoFar(
    totalAmountLockedOnEth: UInt64
  ) {
    // let mintedSoFaraa = this.mintedSoFar.getAndRequireEquals();
    // Provable.log(mintedSoFaraa, 'minted so farrrrrrrr');
    // let amount = totalAmountLockedOnEth.sub(mintedSoFar);
    this.mintedSoFar.set(totalAmountLockedOnEth);
    this.self.body.mayUseToken = AccountUpdate.MayUseToken.InheritFromParent;
    return this.self;
  }
}
