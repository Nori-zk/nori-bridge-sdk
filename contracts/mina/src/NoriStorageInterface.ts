import { Field, SmartContract, state, State, method } from 'o1js';

const underflowProtectionMessage = `lockedSoFar is less than mintedSoFar. 
This would cause a negative mint amount (underflow), so minting is blocked. 
This situation arises when multiple Ethereum addresses deposit to the same nETH account, 
which is outside the supported design and must be avoided.`;

const zeroMintErrorMessage = `No new amount to mint. The requested lockedSoFar equals mintedSoFar, minting zero tokens is not allowed.`;

/**
 * The contract stores the cumulative amount of token user has minted or burned. 
 * 
 * NOTE: Accounts with this contract deployed normally is a `Token Holder Account` based on specific `Token Owner Account` with `NoriTokenController` deployed. 
 * 
 * NOTE: Since all operations on `Token Holder Account` require token owner's approval, we migrate `operations validity check`(like signature check, etc.) into token owner's methods invoked by user.
 */
export class NoriStorageInterface extends SmartContract {
  @state(Field) userKeyHash = State<Field>();
  @state(Field) mintedSoFar = State<Field>();
  @state(Field) burnedSoFar = State<Field>();
  @state(Field) receiver = State<Field>();

  /**
   * calc amount to Mint and maintain `mintedSoFar`
   * 
   * NOTE: Since all operations on `Token Holder Account` require token owner's approval, we migrate `operations validity check`(like signature check, etc.) into token owner's methods invoked by user.
   * 
   * @param lockedSoFar the cumulative amount of user's locked token  on Ethereum contract side
   * @returns amount to Mint
   */
  @method.returns(Field)
  async increaseMintedAmount(lockedSoFar: Field) {

    let mintedSoFar = this.mintedSoFar.getAndRequireEquals();

    // Underflow protection (amountToMint cannot be negative)
    lockedSoFar.assertGreaterThanOrEqual(mintedSoFar, underflowProtectionMessage);

    // Calculate amount to mint
    const amountToMint = lockedSoFar.sub(mintedSoFar);

    // Assert that we actually have something to mint (make sure amountToMint is not zero)
    amountToMint.assertGreaterThan(Field(0), zeroMintErrorMessage);

    // Set mintedSoFar to the new mint amount plus the original amountToMint.
    this.mintedSoFar.set(mintedSoFar.add(amountToMint));

    return amountToMint;
    // Provable.log(mintedSoFaraa, 'minted so farrrrrrrr');
    // let amount = totalAmountLockedOnEth.sub(mintedSoFar);
    // this.mintedSoFar.set(mintedSoFar.add(amount));
    // this.self.body.mayUseToken = AccountUpdate.MayUseToken.InheritFromParent;
    // return this.self;
  }

  /**
   * Adds `amountToBurn` to the cumulative `burnedSoFar` and records the receiver.
   *
   * NOTE: Since all operations on `Token Holder Account` require token owner's approval, we migrate `operations validity check`(like signature check, etc.) into token owner's methods invoked by user.
   *
   * @param amountToBurn the amount being burned in this call
   * @param receiver the Ethereum receiver address (Field-encoded)
   * @returns the new cumulative `burnedSoFar` after adding `amountToBurn`
   */
  @method.returns(Field)
  async addBurnGetCumulative(amountToBurn: Field, receiver: Field) {
    let burnedSoFar = this.burnedSoFar.getAndRequireEquals();

    // Compute the new cumulative burnedSoFar and persist it.
    const newBurnedSoFar = burnedSoFar.add(amountToBurn);
    this.burnedSoFar.set(newBurnedSoFar);

    this.receiver.set(receiver);

    return newBurnedSoFar;
  }
}
