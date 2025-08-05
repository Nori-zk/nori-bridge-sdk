import { getCredentialAttestationWorker } from './node/parent.js';

describe('CredentialAttestationWorker', () => {
    let credentialAttestationWorker: ReturnType<typeof getCredentialAttestationWorker>;
    beforeAll(() => {
        credentialAttestationWorker = getCredentialAttestationWorker();
    });
    afterAll(() => {
        credentialAttestationWorker.terminate();
    });
    it('should_compile_credential_attestation_message', async () => {
        console.log('Called credentialAttestation.compile');
        await credentialAttestationWorker.compile();
    });
});
