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
  Int64,
} from 'o1js';

/** Stores  */
export class EscrowStorage extends SmartContract {
  @state(Field) userKeyHash = State<Field>();
  @state(Int64) mintedSoFar = State<Int64>();

  @method async mock() {
    Field(1).assertEquals(Field(1));
  }
  @method
  // .returns(AccountUpdate)
  async increaseMintedAmount(amount: Int64) {
    amount.isPositive().assertEquals(true);
    let mintedSoFar = this.mintedSoFar.get();
    this.mintedSoFar.requireEquals(mintedSoFar);
    // Provable.log(mintedSoFaraa, 'minted so farrrrrrrr');
    // let amount = totalAmountLockedOnEth.sub(mintedSoFar);
    this.mintedSoFar.set(mintedSoFar.add(amount));
    // this.self.body.mayUseToken = AccountUpdate.MayUseToken.InheritFromParent;
    // return this.self;
  }
}
