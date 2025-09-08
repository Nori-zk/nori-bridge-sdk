import { Bool, Field, method, SmartContract, State, state } from 'o1js';
import { verifyCodeChallenge } from '../micro/pkarm.js';

export class CodeChallengeSmartContract extends SmartContract {
    @state(Bool) mintLock = State<Bool>();
    @method
    async verifyChallenge(codeVerifier: Field, codeChallenge: Field) {
        verifyCodeChallenge(codeVerifier, codeChallenge);
    }
}
