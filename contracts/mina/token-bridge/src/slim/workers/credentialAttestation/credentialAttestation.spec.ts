import { getCredentialAttestationWorker } from './node/parent.js';

describe('CredentialAttestationWorker', () => {
    const CredentialAttestationWorker = getCredentialAttestationWorker();
    let credentialAttestationWorker = new CredentialAttestationWorker();
    afterAll(() => {
        credentialAttestationWorker.terminate();
    });
    it('should_compile_credential_attestation_message', async () => {
        console.log('Called credentialAttestation.compile');
        await credentialAttestationWorker.compile();
    });
});
