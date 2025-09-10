import {
  AccountUpdate,
  Bool,
  PublicKey,
  UInt64,
  VerificationKey,
} from 'o1js';

export interface FungibleTokenAdminBase {
  canMint(au: AccountUpdate): Promise<Bool>;
  canChangeAdmin(admin: PublicKey): Promise<Bool>;
  canPause(): Promise<Bool>;
  canResume(): Promise<Bool>;
  canChangeVerificationKey(vk: VerificationKey): Promise<Bool>;
}

export interface MintableToken {
  mint(recipient: PublicKey, amount: UInt64): Promise<AccountUpdate>;
}
