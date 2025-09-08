import { Bool, Field, method, SmartContract, State, state } from 'o1js';
import { verifyCodeChallenge } from '../micro/pkarm.js';
import {
    contractDepositCredentialAndTotalLockedToFields,
    getContractDepositSlotRootFromContractDepositAndWitness,
    MerkleTreeContractDepositAttestorInput,
    verifyDepositSlotRoot,
} from '../micro/depositAttestation.js';
import { EthProofType } from '@nori-zk/o1js-zk-utils';

export class CodeChallengeMerkleAndEthVerifierSmartContract extends SmartContract {
    @state(Bool) mintLock = State<Bool>();

     @method public async noriMint(
        ethVerifierProof: EthProofType,
        merkleTreeContractDepositAttestorInput: MerkleTreeContractDepositAttestorInput,
        codeVerifierPKARM: Field        
    ) {
        const userAddress = this.sender.getUnconstrained(); //TODO make user pass signature due to limit of AU

        // Validate consensus mpt proof which includes the deposit contract slot root.
        ethVerifierProof.verify();

        // Calculate the deposit slot root
        // This just proves that the index and value with the witness yield a root
        // Aka some value exists at some index and yields a certain root
        const contractDepositSlotRoot = getContractDepositSlotRootFromContractDepositAndWitness(
            merkleTreeContractDepositAttestorInput
        );

        // Validates that the generated root and the contractDepositSlotRoot within the eth proof match.
        verifyDepositSlotRoot(
            contractDepositSlotRoot,
            ethVerifierProof
        );

        // Extract out the contract deposit credential and the tokens locked from the merkle merkleTreeContractDepositAttestorInput as fields
        const { totalLocked, attestationHash: codeChallengePKARM } =
            contractDepositCredentialAndTotalLockedToFields(
                merkleTreeContractDepositAttestorInput
            );

        // Verify the code challenge
        verifyCodeChallenge(codeVerifierPKARM, codeChallengePKARM);
    }
}