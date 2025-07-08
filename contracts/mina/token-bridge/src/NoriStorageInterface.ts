import { Field, SmartContract, state, State, method } from 'o1js';

/** Stores  */
export class NoriStorageInterface extends SmartContract {
  @state(Field) userKeyHash = State<Field>();
  @state(Field) mintedSoFar = State<Field>();

  @method.returns(Field)
  async increaseMintedAmount(lockedSoFar: Field) {
    let mintedSoFar = this.mintedSoFar.getAndRequireEquals();
    const amountToMint = lockedSoFar.sub(mintedSoFar);
    amountToMint.assertGreaterThan(Field(0));
    this.mintedSoFar.set(mintedSoFar.add(amountToMint));
    return amountToMint;
    // Provable.log(mintedSoFaraa, 'minted so farrrrrrrr');
    // let amount = totalAmountLockedOnEth.sub(mintedSoFar);
    // this.mintedSoFar.set(mintedSoFar.add(amount));
    // this.self.body.mayUseToken = AccountUpdate.MayUseToken.InheritFromParent;
    // return this.self;
  }
}
