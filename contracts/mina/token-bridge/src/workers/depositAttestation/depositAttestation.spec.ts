import { compileDepositAttestationPreRequisites } from '../../depositAttestation.js';
import { getDepositAttestation } from './node/parent.js';

const depositAttestation = getDepositAttestation();
afterAll(() => {
    depositAttestation.terminate();
});

async function compile() {
    try {
        console.log('inside the worker');
        await compileDepositAttestationPreRequisites();
    } catch (e) {
        console.log('e', e);
    }
}

describe('DepositAttestationWorker', () => {
    it('should_compile_deposit_attestation_message', async () => {
        console.log('Called depositAttestation.compile');
        await depositAttestation.compile();
    });
});
