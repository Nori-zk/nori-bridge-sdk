import { lockTokens } from '../testUtils.js';
import { Field } from 'o1js';

const codeChallengeBigInt = BigInt('0x1edc891c0ea28b6157e8460304e20a534f3b29a9dbb2d499a58fa2d1de6b3c4a');
const codeChallengeField = Field(codeChallengeBigInt);

describe('lockTokens task integration', () => {
    it('should return a block number from stdout', async () => {
        const blockNumber = await lockTokens(codeChallengeField, 0.0001);
        expect(blockNumber).not.toBeNull();
        expect(blockNumber).toBeGreaterThan(0);
    });
});
