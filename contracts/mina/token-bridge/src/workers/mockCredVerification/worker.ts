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

export class EthProofType extends EthProof {}
export class ContractDepositAttestorProofType extends ContractDepositAttestorProof {}

/*export class MockCredVerifierOutput extends Struct({
    depositValue: Field,
}) {}*/

export class MockVerifier extends SmartContract {
    @method.returns(Field) async verifyPresentation(
        ethVerifierProof: EthProofType,
        contractDepositAttestorProof: ContractDepositAttestorProofType,
        presentation: ProvableEcdsaSigPresentation
    ): Promise<Field> {
        // proof 1 proof 2 /// attestation credential hashing in future
        // verify x2

        ethVerifierProof.verify();
        contractDepositAttestorProof.verify();

        let { claims, outputClaim } = presentation.verify({
            publicKey: this.address,
            tokenId: this.tokenId,
            methodName: 'verifyPresentation',
        });

        // Extract roots from public inputs

        const depositAttestationProofRoot =
            contractDepositAttestorProof.publicOutput;
        const ethVerifierStorageProofRootBytes =
            ethVerifierProof.publicInput.verifiedContractDepositsRoot.bytes; // I think the is BE

        // Convert verifiedContractDepositsRoot from bytes to field
        let ethVerifierStorageProofRoot = new Field(0);
        // FIXME
        // Turn into a LE field?? This seems wierd as on the rust side we have fixed_bytes[..32].copy_from_slice(&root.to_bytes());
        // And here we re-interpret the BE as LE!
        // But it does pass the test! And otherwise fails.
        for (let i = 31; i >= 0; i--) {
            ethVerifierStorageProofRoot = ethVerifierStorageProofRoot
                .mul(256)
                .add(ethVerifierStorageProofRootBytes[i].value);
        }

        // Assert roots
        depositAttestationProofRoot.assertEquals(ethVerifierStorageProofRoot);

        // Mock attestation assert
        const contractDepositAttestorPublicInputs =
            contractDepositAttestorProof.publicInput.value;
        // Convert contractDepositAttestorPublicInputs.attestationHash from bytes into a field
        const contractDepositAttestorProofCredentialBytes =
            contractDepositAttestorPublicInputs.attestationHash.bytes;
        let contractDepositAttestorProofCredential = new Field(0);
        // Turn into field
        for (let i = 0; i < 32; i++) {
            contractDepositAttestorProofCredential =
                contractDepositAttestorProofCredential
                    .mul(256)
                    .add(contractDepositAttestorProofCredentialBytes[i].value);
        }

        outputClaim.messageHash.assertEquals(
            contractDepositAttestorProofCredential
        );

        // Turn totalLocked into a field
        const totalLockedBytes =
            contractDepositAttestorPublicInputs.value.bytes;
        let totalLocked = new Field(0);
        for (let i = 31; i >= 0; i--) {
            totalLocked = totalLocked.mul(256).add(totalLockedBytes[i].value);
        }

        // value (amount), execution root, storage desposit root, attestation hash

        // @jk CHECKME
        const depositBytes =
            contractDepositAttestorProof.publicInput.value.value;
        let depositField = new Field(0);
        for (let i = 0; i >= 31; i++) {
            depositField = depositField
                .mul(256)
                .add(depositBytes.bytes[i].value);
        }

        return depositField;
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
        const ethVerifierProof = await EthProofType.fromJSON(ethVerifierProofJson);
        const depositAttestionProof = await ContractDepositAttestorProofType.fromJSON(
            depositAttestationProofJson
        );
        const senderPrivateKey = PrivateKey.fromBase58(senderPrivateKeyBase58);
        const presentation = Presentation.fromJSON(presentationJsonStr);
        const provableEcdsaSigPresentation = ProvableEcdsaSigPresentation.from(presentation);
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
                
                const depositValue = await mockCredVerifierInst.verifyPresentation(ethVerifierProof, depositAttestionProof, provableEcdsaSigPresentation);

                console.log('✅ mockCredVerifierInst.verifyPresentation verified!');
                console.log('ProvableEcdsaSigPresentation depositValue:', depositValue);
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
