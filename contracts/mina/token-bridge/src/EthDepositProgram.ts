import {
    EthProof,
    ContractDepositAttestorProof,
    ContractDepositAttestor,
    EthVerifier,
} from '@nori-zk/o1js-zk-utils';
import { Field, Provable, Struct, ZkProgram } from 'o1js';
import { Logger } from 'esm-iso-logger';

const logger = new Logger('EthDepositProgram');

export class EthDepositProgramInput extends Struct({
    credentialAttestationHash: Field,
}) {}

export class EthDepositProgramOutput extends Struct({
    totalLocked: Field,
    storageDepositRoot: Field,
    attestationHash: Field,
}) {}

export const EthDepositProgram = ZkProgram({
    name: 'EthDepositProgram',
    publicInput: EthDepositProgramInput,
    publicOutput: EthDepositProgramOutput,
    methods: {
        compute: {
            privateInputs: [EthProof, ContractDepositAttestorProof],
            async method(
                input: EthDepositProgramInput,
                ethVerifierProof: InstanceType<typeof EthProof>,
                contractDepositAttestorProof: InstanceType<
                    typeof ContractDepositAttestorProof
                >
            ) {
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
                Provable.asProver(() => {
                    Provable.log(
                        'depositAttestationProofRoot',
                        'ethVerifierStorageProofRoot',
                        depositAttestationProofRoot,
                        ethVerifierStorageProofRoot
                    );
                });
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

                Provable.asProver(() => {
                    Provable.log(
                        'input.credentialAttestationHash',
                        'contractDepositAttestorProofCredential',
                        input.credentialAttestationHash,
                        contractDepositAttestorProofCredential
                    );
                });

                input.credentialAttestationHash.assertEquals(
                    contractDepositAttestorProofCredential
                );

                Provable.asProver(() => {
                    logger.log(
                        contractDepositAttestorPublicInputs.value.bytes.map(
                            (byte) => byte.toBigInt()
                        )
                    );
                });

                // Turn totalLocked into a field
                const totalLockedBytes =
                    contractDepositAttestorPublicInputs.value.bytes;
                let totalLocked = new Field(0);
                /*for (let i = 31; i >= 0; i--) {
                    totalLocked = totalLocked
                        .mul(256)
                        .add(totalLockedBytes[i].value);
                }*/
                for (let i = 0; i < 32; i++) {
                    totalLocked = totalLocked
                        .mul(256)
                        .add(totalLockedBytes[i].value);
                }

                // Perhaps flip this??
                // We interpret contractDepositAttestorProofCredential to BE so why not this??

                const storageDepositRoot = ethVerifierStorageProofRoot;
                const attestationHash = contractDepositAttestorProofCredential;

                return {
                    publicOutput: new EthDepositProgramOutput({
                        totalLocked,
                        storageDepositRoot,
                        attestationHash,
                    }),
                };
            },
        },
    },
});

// E2EPrerequisitesProgram
export const EthDepositProgramProof = ZkProgram.Proof(EthDepositProgram);
export class EthDepositProgramProofType extends EthDepositProgramProof {}

export async function compilePreRequisites() {
    // TODO optimise not all of these need to be compiled immediately

    let startTime = Date.now();
    const { verificationKey: contractDepositAttestorVerificationKey } =
        await ContractDepositAttestor.compile({ forceRecompile: true });
    logger.log(`ContractDepositAttestor compile took ${Date.now() - startTime}ms`);
    logger.log(
        `ContractDepositAttestor contract compiled vk: '${contractDepositAttestorVerificationKey.hash}'.`
    );

    startTime = Date.now();
    const { verificationKey: ethVerifierVerificationKey } =
        await EthVerifier.compile({ forceRecompile: true });
    logger.log(`EthVerifier compile took ${Date.now() - startTime}ms`);
    logger.log(
        `EthVerifier compiled vk: '${ethVerifierVerificationKey.hash}'.`
    );

    startTime = Date.now();
    const { verificationKey: e2ePrerequisitesVerificationKey } =
        await EthDepositProgram.compile({ forceRecompile: true });
    logger.log(`E2EPrerequisitesProgram compile took ${Date.now() - startTime}ms`);
    logger.log(
        `E2EPrerequisitesProgram contract compiled vk: '${e2ePrerequisitesVerificationKey.hash}'.`
    );
}
