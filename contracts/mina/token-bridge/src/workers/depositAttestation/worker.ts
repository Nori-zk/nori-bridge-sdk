import {
    EthDepositProgram,
    EthDepositProgramInput,
} from 'src/e2ePrerequisites.js';
import {
    compileDepositAttestationPreRequisites,
    computeDepositAttestation,
} from '../../depositAttestation.js';
import { Field } from 'o1js/dist/node/index.js';

export class DepositAttestationWorker {
    async compileAttestation() {
        try {
            console.log('inside the worker');
            await compileDepositAttestationPreRequisites();
        } catch (e) {
            console.log('e', e);
        }
    }
    async computeAttestation(
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
        console.log(
            'depositAttestationProof.publicInput.rootHash',
            depositAttestationProof.publicInput.rootHash
        );
        console.log(
            'depositAttestationProof.publicInput.value.attestationHash',
            depositAttestationProof.publicInput.value.attestationHash.toHex()
        );
        console.log(
            'ethVerifierProof.publicInput.verifiedContractDepositsRoot',
            ethVerifierProof.publicInput.verifiedContractDepositsRoot.toHex()
        );

        const depositAttestationProofJson = depositAttestationProof.toJSON();
        const ethVerifierProofJson = ethVerifierProof.toJSON();
        return {
            despositSlotRaw,
            depositAttestationProofJson,
            ethVerifierProofJson,
        };
    }

    //async compile
    async compile() {
        await compileDepositAttestationPreRequisites();
        console.time('EthDepositProgram compile');
        const { verificationKey: EthDepositProgramVerificationKey } =
            await EthDepositProgram.compile({
                forceRecompile: true,
            });
        console.timeEnd('EthDepositProgram compile');
        console.log(
            `EthDepositProgram compiled vk: '${EthDepositProgramVerificationKey.hash}'.`
        );
    }

    async compute(
        attestationBEHex: string,
        depositBlockNumber: number,
        ethAddressLowerHex: string
    ) {

        const { depositAttestationProof, ethVerifierProof, despositSlotRaw } =
            await computeDepositAttestation(
                depositBlockNumber,
                ethAddressLowerHex,
                attestationBEHex
            );


        /*const e2ePrerequisitesInput = new EthDepositProgramInput({
            credentialAttestationHash: messageHash,
        });

        console.log('Computing e2e');
        console.time('E2EPrerequisitesProgram.compute');
        const e2ePrerequisitesProof = await EthDepositProgram.compute(
            e2ePrerequisitesInput,
            ethVerifierProof,
            depositAttestationProof
        );
        console.timeEnd('E2EPrerequisitesProgram.compute');

        return e2ePrerequisitesProof.proof.toJSON();*/
    }
}
