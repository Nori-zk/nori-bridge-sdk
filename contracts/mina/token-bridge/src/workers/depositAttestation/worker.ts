import {
    EthDepositProgram,
    EthDepositProgramInput,
} from '../../e2ePrerequisites.js';
import {
    compileDepositAttestationPreRequisites,
    computeDepositAttestation,
} from '../../depositAttestation.js';
import { Bytes, Field } from 'o1js';
import { wordToBytes } from '@nori-zk/proof-conversion/min';

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
        presentationJson: string,
        depositBlockNumber: number,
        ethAddressLowerHex: string
    ) {
        const presentation = JSON.parse(presentationJson);
        const messageHashString =
            presentation.outputClaim.value.messageHash.value;
        const messageHashBigInt = BigInt(messageHashString);
        const credentialAttestationHash = Field.from(messageHashBigInt);
        const beAttestationHashBytes = Bytes.from(
            wordToBytes(credentialAttestationHash, 32).reverse()
        );
        const attestationBEHex = `0x${beAttestationHashBytes.toHex()}`; // this does not have the 0x....
        const { depositAttestationProof, ethVerifierProof, despositSlotRaw } =
            await computeDepositAttestation(
                depositBlockNumber,
                ethAddressLowerHex,
                attestationBEHex
            );

        const e2ePrerequisitesInput = new EthDepositProgramInput({
            credentialAttestationHash,
        });

        console.log('Computing e2e');
        console.time('E2EPrerequisitesProgram.compute');
        const ethDepositProof = await EthDepositProgram.compute(
            e2ePrerequisitesInput,
            ethVerifierProof,
            depositAttestationProof
        );
        console.timeEnd('E2EPrerequisitesProgram.compute');

        return { despositSlotRaw, ethDepositProofJson: ethDepositProof.proof.toJSON() };
    }
}
