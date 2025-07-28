import {
    EthProof,
    ContractDepositAttestorProof,
    ContractDepositAttestor,
    EthVerifier,
} from '@nori-zk/o1js-zk-utils';
import {
    AccountUpdate,
    Field,
    Mina,
    PrivateKey,
    Struct,
    ZkProgram,
} from 'o1js';
import {
    compileEcdsaEthereum,
    compileEcdsaSigPresentationVerifier,
    EcdsaSigPresentationVerifier,
    ProvableEcdsaSigPresentation,
} from './attestation.js';
import { Presentation } from 'mina-attestations';

export class E2ePrerequisitesInput extends Struct({
    //ethVerifierProof: EthProof.provable,
    //contractDepositAttestorProof: ContractDepositAttestorProof.provable,
    credentialAttestationHash: Field,
    // AttestationHash (as temporary input) [this is not no how we will do it but good for test]
    // ...???? CredentialAttestaionProof (private credential ) -> output owner of private (public key.... MINA)
    // COULD BE HASH OF THIS PROOF..... IGNORE THIS FOR THIS TEST
}) {}

export class E2ePrerequisitesOutput extends Struct({
    totalLocked: Field,
    storageDepositRoot: Field,
    attestationHash: Field,
}) {}

export const E2EPrerequisitesProgram = ZkProgram({
    name: 'E2EPrerequisites',
    publicInput: E2ePrerequisitesInput,
    publicOutput: E2ePrerequisitesOutput,
    methods: {
        compute: {
            privateInputs: [EthProof, ContractDepositAttestorProof],
            async method(
                input: E2ePrerequisitesInput,
                ethVerifierProof: InstanceType<typeof EthProof>,
                contractDepositAttestorProof: InstanceType<
                    typeof ContractDepositAttestorProof
                >
            ) {
                // proof 1 proof 2 /// attestation credential hashing in future
                // verify x2

                ethVerifierProof.verify();
                contractDepositAttestorProof.verify();

                // Extract roots from public inputs

                const depositAttestationProofRoot =
                    contractDepositAttestorProof.publicOutput;
                const ethVerifierStorageProofRootBytes =
                    ethVerifierProof.publicInput.verifiedContractDepositsRoot
                        .bytes; // I think the is BE

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
                depositAttestationProofRoot.assertEquals(
                    ethVerifierStorageProofRoot
                );

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
                            .add(
                                contractDepositAttestorProofCredentialBytes[i]
                                    .value
                            );
                }
                input.credentialAttestationHash.assertEquals(
                    contractDepositAttestorProofCredential
                );

                // Turn totalLocked into a field
                const totalLockedBytes =
                    contractDepositAttestorPublicInputs.value.bytes;
                let totalLocked = new Field(0);
                for (let i = 31; i >= 0; i--) {
                    totalLocked = totalLocked
                        .mul(256)
                        .add(totalLockedBytes[i].value);
                }

                // value (amount), execution root, storage desposit root, attestation hash

                const storageDepositRoot = ethVerifierStorageProofRoot;
                const attestationHash = contractDepositAttestorProofCredential;

                return {
                    publicOutput: new E2ePrerequisitesOutput({
                        totalLocked,
                        storageDepositRoot,
                        attestationHash,
                    }),
                };
            },
        },
    },
});

export async function compilePreRequisites() {
    // TODO optimise not all of these need to be compiled immediately

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
    const { verificationKey: e2ePrerequisitesVerificationKey } =
        await E2EPrerequisitesProgram.compile({ forceRecompile: true });
    console.timeEnd('E2EPrerequisitesProgram compile');
    console.log(
        `E2EPrerequisitesProgram contract compiled vk: '${e2ePrerequisitesVerificationKey.hash}'.`
    );
}

export async function deployAndVerifyEcdsaSigPresentationVerifier(
    zkAppPrivateKey: PrivateKey,
    senderPrivateKey: PrivateKey,
    presentationJSON: string
) {
    const senderPublicKey = senderPrivateKey.toPublicKey();
    const zkAppPublicKey = zkAppPrivateKey.toPublicKey();
    const zkApp = new EcdsaSigPresentationVerifier(zkAppPublicKey);
    const deployTx = await Mina.transaction(
        { sender: senderPublicKey, fee: 0.01 * 1e9 },
        async () => {
            AccountUpdate.fundNewAccount(senderPublicKey);
            await zkApp.deploy();
            const presentation = Presentation.fromJSON(presentationJSON);
            const provablePresentation =
                ProvableEcdsaSigPresentation.from(presentation);
            const claims = await zkApp.verifyPresentation(provablePresentation);
            console.log('✅ ProvablePresentation verified!');
            console.log('ProvableEcdsaSigPresentation claims:', claims);
        }
    );

    console.log('Deploy transaction created successfully. Proving...');
    await deployTx.prove();
    console.log('Transaction proved. Signing and sending the transaction...');
    await deployTx.sign([senderPrivateKey, zkAppPrivateKey]).send().wait();
    console.log(
        '✅ EcdsaSigPresentationVerifier deployed and verified successfully.'
    );

    // May have to verifiy presentation in 2nd tx... Seems like its not necessary.
}
