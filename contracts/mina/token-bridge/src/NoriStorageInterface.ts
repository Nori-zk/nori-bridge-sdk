import { Field, SmartContract, state, State, method } from 'o1js';

const UNDERFLOW_PROTECTION_MESSAGE = `lockedSoFar is less than mintedSoFar. 
This would cause a negative mint amount (underflow), so minting is blocked. 
This situation arises when multiple Ethereum addresses deposit to the same nETH account, 
which is outside the supported design and must be avoided.`;

const ZERO_MINT_ERROR_MESSAGE = `No new amount to mint. The requested lockedSoFar equals mintedSoFar, minting zero tokens is not allowed.`;

const PERMISSION_CHECK_ERROR_MESSAGE  = `\`editState\` MUST be by proof and \`setPermissions\` MUST be by proof `;


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
    lockedSoFar.assertGreaterThanOrEqual(mintedSoFar, UNDERFLOW_PROTECTION_MESSAGE);
    
    // Calculate amount to mint
    const amountToMint = lockedSoFar.sub(mintedSoFar);

    // Assert that we actually have something to mint (make sure amountToMint is not zero)
    amountToMint.assertGreaterThan(Field(0), ZERO_MINT_ERROR_MESSAGE);

    // Set mintedSoFar to the new mint amount plus the original amountToMint.
    this.mintedSoFar.set(mintedSoFar.add(amountToMint));

    return amountToMint;
    // Provable.log(mintedSoFaraa, 'minted so farrrrrrrr');
    // let amount = totalAmountLockedOnEth.sub(mintedSoFar);
    // this.mintedSoFar.set(mintedSoFar.add(amount));
    // this.self.body.mayUseToken = AccountUpdate.MayUseToken.InheritFromParent;
    // return this.self;
  }
  
  public checkPermissionsValidity() {
    let permissions = this.self.update.permissions;

    let { editState, setPermissions } = permissions.value;
    let editStateIsProof = Provable.equal(
      Types.AuthRequired,
      editState,
      Permissions.proof()
    );
    let setPermissionsIsProof = Provable.equal(
      Types.AuthRequired,
      setPermissions,
      Permissions.proof()
    );
    let updateAllowed = editStateIsProof.and(setPermissionsIsProof);

    assert(
      updateAllowed,
      PERMISSION_CHECK_ERROR_MESSAGE 
    );
  }

}
