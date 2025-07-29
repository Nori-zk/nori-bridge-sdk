import {
    compileDepositAttestationPreRequisites,
    computeDepositAttestation,
} from '../../depositAttestation.js';

export class DepositAttestationWorker {
    async compile() {
        try {
            console.log('inside the worker');
            await compileDepositAttestationPreRequisites();
        } catch (e) {
            console.log('e', e);
        }
    }
    async compute(
        depositBlockNumber: number,
        ethAddressLowerHex: string,
        attestationBEHex: string
    ) {
        const { depositAttestationProof, ethVerifierProof, despositSlotRaw } =
            await computeDepositAttestation(
                depositBlockNumber,
                ethAddressLowerHex,
                attestationBEHex
            );
        const depositAttestationProofJson = depositAttestationProof.toJSON();
        const ethVerifierProofJson = ethVerifierProof.toJSON();
        return {
            despositSlotRaw,
            depositAttestationProofJson,
            ethVerifierProofJson,
        };
    }
}
