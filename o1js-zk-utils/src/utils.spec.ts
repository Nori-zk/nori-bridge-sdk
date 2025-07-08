import { decodeConsensusMptProof } from './utils';
import { sp1ConsensusMPTPlonkProof } from './test-examples/sp1-mpt-proof/sp1ProofMessage.js';

describe('ConsensusMPT marshaller Integration Test', () => {
    test('should decode consensus mpt transition proof', async () => {
        const decodedProof = decodeConsensusMptProof(
            sp1ConsensusMPTPlonkProof.proof
        );
        console.log('decodedProof', decodedProof);
    });
});
