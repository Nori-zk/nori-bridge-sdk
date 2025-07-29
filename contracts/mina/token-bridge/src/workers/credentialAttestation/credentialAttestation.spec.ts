import { getCredentialAttestation } from './node/parent.js';

const credentialAttestation = getCredentialAttestation();
afterAll(() => {
    credentialAttestation.terminate();
});

describe('CredentialAttestationWorker', () => {
    it('should_compile_credential_attestation_message', async () => {
        console.log('Called credentialAttestation.compile');
        await credentialAttestation.compile();
    });
});
