import {
    AccountUpdate,
    Bytes,
    Field,
    JsonProof,
    method,
    Mina,
    PrivateKey,
    SmartContract,
    Struct,
} from 'o1js';
import { EthProof, EthVerifier } from '@nori-zk/o1js-zk-utils';
import {
    ContractDepositAttestor,
    ContractDepositAttestorProof,
} from '@nori-zk/o1js-zk-utils';
import {
    compileEcdsaEthereum,
    compileEcdsaSigPresentationVerifier,
    ProvableEcdsaSigPresentation,
} from '../../credentialAttestation.js';
import { Presentation } from 'mina-attestations';
import { minaSetup } from '../../testUtils.js';
import {
    E2ePrerequisitesInput,
    E2EPrerequisitesProgram,
    E2EPrerequisitesProgramProofType,
} from '../../e2ePrerequisites.js';

export class EthProofType extends EthProof {}
export class ContractDepositAttestorProofType extends ContractDepositAttestorProof {}

/*export class MockCredVerifierOutput extends Struct({
    depositValue: Field,
}) {}*/

export class MockVerifier extends SmartContract {
    @method.returns(Field) async verifyPresentation(
        //ethVerifierProof: EthProofType,
        //contractDepositAttestorProof: ContractDepositAttestorProofType,
        e2eProof: E2EPrerequisitesProgramProofType,
        presentation: ProvableEcdsaSigPresentation
    ): Promise<Field> {
        // proof 1 proof 2 /// attestation credential hashing in future
        // verify x2

        e2eProof.verify();

        //e2eProof.publicOutput.attestationHash;
        //e2eProof.publicOutput.totalLocked
        //e2eProof.publicOutput.storageDepositRoot; // eth processor

        let { claims, outputClaim } = presentation.verify({
            publicKey: this.address,
            tokenId: this.tokenId,
            methodName: 'verifyPresentation',
        });

        e2eProof.publicOutput.attestationHash.assertEquals(
            outputClaim.messageHash
        );

        return e2eProof.publicOutput.totalLocked;
    }
}

export class MockVerificationWorker {
    async compile() {
        // Compile programs / contracts
        console.time('compileEcdsaEthereum');
        await compileEcdsaEthereum();
        console.timeEnd('compileEcdsaEthereum'); // 1:20.330 (m:ss.mmm)

        console.time('compilePresentationVerifier');
        await compileEcdsaSigPresentationVerifier();
        console.timeEnd('compilePresentationVerifier'); // 11.507s

        console.time('ContractDepositAttestor compile');
        const { verificationKey: contractDepositAttestorVerificationKey } =
            await ContractDepositAttestor.compile({ forceRecompile: true });
        console.timeEnd('ContractDepositAttestor compile');
        console.log(
            `ContractDepositAttestor contract compiled vk: '${contractDepositAttestorVerificationKey.hash}'.`
        );

        console.time('EthVerifier compile');
        const { verificationKey: ethVerifierVerificationKey } =
            await EthVerifier.compile({ forceRecompile: true });
        console.timeEnd('EthVerifier compile');
        console.log(
            `EthVerifier compiled vk: '${ethVerifierVerificationKey.hash}'.`
        );

        console.time('E2EPrerequisitesProgram compile');
        const { verificationKey: mockE2EPrerequisitesProgram } =
            await E2EPrerequisitesProgram.compile({ forceRecompile: true });
        console.timeEnd('E2EPrerequisitesProgram compile');
        console.log(
            `E2EPrerequisitesProgram compiled vk: '${mockE2EPrerequisitesProgram.hash}'.`
        );

        console.time('MockCredVerifier compile');
        const { verificationKey: mockCredVerifierVerificationKey } =
            await MockVerifier.compile({ forceRecompile: true });
        console.timeEnd('MockCredVerifier compile');
        console.log(
            `MockCredVerifier compiled vk: '${mockCredVerifierVerificationKey.hash}'.`
        );
    }

    async verify(
        ethVerifierProofJson: JsonProof,
        depositAttestationProofJson: JsonProof,
        senderPrivateKeyBase58: string,
        presentationJsonStr: string
    ) {
        const presentationObj = JSON.parse(presentationJsonStr);
        const messageHashString =
            presentationObj.outputClaim.value.messageHash.value;
        const messageHashBigInt = BigInt(messageHashString);
        const messageHash = Field.from(messageHashBigInt);

        const ethVerifierProof = await EthProofType.fromJSON(
            ethVerifierProofJson
        );
        const depositAttestationProof =
            await ContractDepositAttestorProofType.fromJSON(
                depositAttestationProofJson
            );

        // COMPUTE E2E **************************************************

        console.log('Building e2e input');
        // Now the deposit has been processed we are free to compute the e2e proof.
        const e2ePrerequisitesInput = new E2ePrerequisitesInput({
            credentialAttestationHash: messageHash,
        });

        console.log('Computing e2e');
        console.time('E2EPrerequisitesProgram.compute');
        const e2ePrerequisitesProof = await E2EPrerequisitesProgram.compute(
            e2ePrerequisitesInput,
            ethVerifierProof,
            depositAttestationProof
        );
        console.timeEnd('E2EPrerequisitesProgram.compute');

        console.log('Computed E2EPrerequisitesProgram proof');

        // Other stuff

        const senderPrivateKey = PrivateKey.fromBase58(senderPrivateKeyBase58);
        const presentation = Presentation.fromJSON(presentationJsonStr);

        const provableEcdsaSigPresentation =
            ProvableEcdsaSigPresentation.from(presentation);
        const senderPublicKey = senderPrivateKey.toPublicKey();

        const zkAppPrivateKey = PrivateKey.random();
        const zkAppPublicKey = zkAppPrivateKey.toPublicKey();

        // Setup mina
        await minaSetup();

        const mockCredVerifierInst = new MockVerifier(zkAppPublicKey);

        const deployTx = await Mina.transaction(
            { sender: senderPublicKey, fee: 0.01 * 1e9 },
            async () => {
                AccountUpdate.fundNewAccount(senderPublicKey);
                await mockCredVerifierInst.deploy();

                const depositValue =
                    await mockCredVerifierInst.verifyPresentation(
                        e2ePrerequisitesProof.proof,
                        provableEcdsaSigPresentation
                    );

                console.log(
                    '✅ mockCredVerifierInst.verifyPresentation verified!'
                );
                console.log(
                    'ProvableEcdsaSigPresentation depositValue:',
                    depositValue
                );
            }
        );

        console.log('Deploy transaction created successfully. Proving...');
        await deployTx.prove();
        console.log(
            'Transaction proved. Signing and sending the transaction...'
        );
        await deployTx.sign([senderPrivateKey, zkAppPrivateKey]).send().wait();
    }
}
