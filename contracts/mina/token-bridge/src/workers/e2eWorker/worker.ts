import {
    ProvableEcdsaSigPresentation,
} from '../../credentialAttestation.js';
import {
    NoriTokenControllerConfig,
    NoriTokenControllerSubmitter,
} from '../../NoriControllerSubmitter.js';
import {
    EthDepositProgramProofType,
} from '../../e2ePrerequisites.js';
import { JsonProof, PrivateKey, PublicKey } from 'o1js';
import { Presentation } from 'mina-attestations';
import { MintProofData } from '../../NoriTokenController.js';

export class E2eWorker {
    #noriTokenControllerSubmitterInst: NoriTokenControllerSubmitter;

    async ready(config: NoriTokenControllerConfig) {
        this.#noriTokenControllerSubmitterInst =
            new NoriTokenControllerSubmitter(config);
        await this.#noriTokenControllerSubmitterInst.compileContracts();
        await this.#noriTokenControllerSubmitterInst.networkSetUp();
    }

    async setupStorage(userPublicKeyBase58: string) {
        const userPublicKey: PublicKey =
            PublicKey.fromBase58(userPublicKeyBase58);
        return this.#noriTokenControllerSubmitterInst.setupStorage(
            userPublicKey
        );
    }

    async mint(
        userPublicKeyBase58: string,
        proofData: {
            ethDepositProofJson: JsonProof;
            presentationProofStr: string;
        },
        userPrivateKeyBase58: string,
        fundNewAccount = true
    ) {
        const userPublicKey: PublicKey =
            PublicKey.fromBase58(userPublicKeyBase58);

        const { ethDepositProofJson, presentationProofStr } = proofData;

        const ethDepositProof = await EthDepositProgramProofType.fromJSON(
            ethDepositProofJson
        );

        const presentationProof = ProvableEcdsaSigPresentation.from(
            Presentation.fromJSON(presentationProofStr)
        );
        const proofDataReInflated: MintProofData = {
            ethDepositProof,
            presentationProof,
        };
        const userPrivateKey: PrivateKey =
            PrivateKey.fromBase58(userPrivateKeyBase58);

        return this.#noriTokenControllerSubmitterInst.mint(
            userPublicKey,
            proofDataReInflated,
            userPrivateKey,
            fundNewAccount
        );
    }
}

/*

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
            await EthDepositProgram.compile({ forceRecompile: true });
        console.timeEnd('E2EPrerequisitesProgram compile');
        console.log(
            `E2EPrerequisitesProgram compiled vk: '${mockE2EPrerequisitesProgram.hash}'.`
        );

        console.time('MockCredVerifier compile');

        console.timeEnd('MockCredVerifier compile');
        console.log(
            `MockCredVerifier compiled vk: '${mockCredVerifierVerificationKey.hash}'.`
        );

*/
