import { Field, SmartContract, state, State, method, Poseidon } from 'o1js';

export class Add extends SmartContract {
  @state(Field) num: State<Field> = State<Field>();

  init() {
    super.init();
    this.num.set(Field(1));
  }

  @method async update() {
    const currentState = this.num.getAndRequireEquals();
    const newState = currentState.add(2);
    this.num.set(newState);
  }
}
