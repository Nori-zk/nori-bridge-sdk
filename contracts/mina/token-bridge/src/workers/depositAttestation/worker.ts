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
        console.log('depositAttestationProof.publicInput.rootHash', depositAttestationProof.publicInput.rootHash);
        console.log('depositAttestationProof.publicInput.value.attestationHash', depositAttestationProof.publicInput.value.attestationHash.toHex());
        console.log('ethVerifierProof.publicInput.verifiedContractDepositsRoot', ethVerifierProof.publicInput.verifiedContractDepositsRoot.toHex())

        const depositAttestationProofJson = depositAttestationProof.toJSON();
        const ethVerifierProofJson = ethVerifierProof.toJSON();
        return {
            despositSlotRaw,
            depositAttestationProofJson,
            ethVerifierProofJson,
        };
    }
}
