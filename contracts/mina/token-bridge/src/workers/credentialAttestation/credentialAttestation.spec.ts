import { getCredentialAttestation } from './node/parent.js';

describe('CredentialAttestationWorker', () => {
    let credentialAttestation: ReturnType<typeof getCredentialAttestation>;
    beforeAll(() => {
        credentialAttestation = getCredentialAttestation();
    });
    afterAll(() => {
        credentialAttestation.terminate();
    });
    it('should_compile_credential_attestation_message', async () => {
        console.log('Called credentialAttestation.compile');
        await credentialAttestation.compile();
    });
});
