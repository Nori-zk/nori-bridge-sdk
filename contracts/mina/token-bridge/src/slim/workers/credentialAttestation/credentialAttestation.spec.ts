import { CredentialAttestationWorker } from './node/parent.js';

describe('CredentialAttestationWorker', () => {
    let credentialAttestationWorker = new CredentialAttestationWorker();
    afterAll(() => {
        credentialAttestationWorker.terminate();
    });
    it('should_compile_credential_attestation_message', async () => {
        console.log('Called credentialAttestation.compile');
        await credentialAttestationWorker.compile();
    });
});
