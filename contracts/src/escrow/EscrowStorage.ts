import { Field, SmartContract, state, State, Bool, UInt32 } from 'o1js';

/** Stores  */
export class EscrowStorage extends SmartContract {
  @state(Field) mintedSoFar = State<Field>();
  // @state(Field) compensations = State<Field>();
}
