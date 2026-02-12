import { Logger, LogPrinter } from 'esm-iso-logger';
import { decodeConsensusMptProof } from './utils';
import { sp1ConsensusMPTPlonkProof } from './test-examples/sp1-mpt-proof/sp1ProofMessage.js';

new LogPrinter('TestEthProcessor');
const logger = new Logger('UtilsSpec');

describe('ConsensusMPT marshaller Integration Test', () => {
    test('should decode consensus mpt transition proof', async () => {
        const decodedProof = decodeConsensusMptProof(
            sp1ConsensusMPTPlonkProof.proof
        );
        logger.log('decodedProof', decodedProof);
    });
});
