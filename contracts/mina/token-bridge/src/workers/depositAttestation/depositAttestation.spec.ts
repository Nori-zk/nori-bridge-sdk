import { getDepositAttestation } from './node/parent.js';

describe('DepositAttestationWorker', () => {
    let depositAttestation: ReturnType<typeof getDepositAttestation>;
    beforeAll(() => {
        depositAttestation = getDepositAttestation();
    });
    afterAll(() => {
        depositAttestation.terminate();
    });
    it('should_compile_deposit_attestation_message', async () => {
        console.log('Called depositAttestation.compile');
        await depositAttestation.compile();
    });
});
