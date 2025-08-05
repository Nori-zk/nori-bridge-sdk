import { getDepositAttestationWorker } from './node/parent.js';

describe('DepositAttestationWorker', () => {
    let depositAttestation: ReturnType<typeof getDepositAttestationWorker>;
    beforeAll(() => {
        depositAttestation = getDepositAttestationWorker();
    });
    afterAll(() => {
        depositAttestation.terminate();
    });
    it('should_compile_deposit_attestation_message', async () => {
        console.log('Called depositAttestation.compile');
        await depositAttestation.compile();
    });
});
