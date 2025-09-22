import { Field, SmartContract, state, State, method } from 'o1js';

const underflowProtectionMessage = `lockedSoFar is less than mintedSoFar. 
This would cause a negative mint amount (underflow), so minting is blocked. 
This situation arises when multiple Ethereum addresses deposit to the same nETH account, 
which is outside the supported design and must be avoided.`;

const zeroMintMessage = `No new amount to mint. The requested lockedSoFar equals mintedSoFar, minting zero tokens is not allowed.`;

/** Stores  */
export class NoriStorageInterface extends SmartContract {
  @state(Field) userKeyHash = State<Field>();
  @state(Field) mintedSoFar = State<Field>();

  @method.returns(Field)
  async increaseMintedAmount(lockedSoFar: Field) {
    let mintedSoFar = this.mintedSoFar.getAndRequireEquals();
    
    // Underflow protection (amountToMint cannot be negative)
    lockedSoFar.assertGreaterThanOrEqual(mintedSoFar, underflowProtectionMessage);
    
    // Calculate amount to mint
    const amountToMint = lockedSoFar.sub(mintedSoFar);

    // Assert that we actually have something to mint (make sure amountToMint is not zero)
    amountToMint.assertGreaterThan(Field(0), zeroMintMessage);

    // Set mintedSoFar to the new mint amount plus the original amountToMint.
    this.mintedSoFar.set(mintedSoFar.add(amountToMint));

    return amountToMint;
    // Provable.log(mintedSoFaraa, 'minted so farrrrrrrr');
    // let amount = totalAmountLockedOnEth.sub(mintedSoFar);
    // this.mintedSoFar.set(mintedSoFar.add(amount));
    // this.self.body.mayUseToken = AccountUpdate.MayUseToken.InheritFromParent;
    // return this.self;
  }
}
