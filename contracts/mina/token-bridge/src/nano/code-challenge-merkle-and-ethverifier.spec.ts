import { AccountUpdate, Field, Mina, NetworkId, PrivateKey } from 'o1js';
import { CodeChallengeMerkleAndEthVerifierSmartContract } from './code-challenge-merkle-and-ethverifier.js';
import { EthProofType, EthVerifier } from '@nori-zk/o1js-zk-utils';
import { codeChallengeFieldToBEHex } from '../micro/pkarm.js';
import {
    buildMerkleTreeContractDepositAttestorInput,
    computeDepositAttestationWitnessAndEthVerifier,
} from '../micro/depositAttestation.js';

describe('should_test_code_challenge_merkle_and_ethverifier', () => {
    test('should_verify_code_challenge_merkle_and_ethverifier', async () => {
        // These are throw away devnet creds
        const minaSenderPrivateKeyBase58 =
            'EKDxnahxEV3y2FG66ZzF97qBQANAoVBbQqqXWCSSDsVJwdeWEV9G';

        // Other configs
        const minaRpcUrl = 'https://devnet.minaprotocol.network/graphql';
        const minaConfig = {
            networkId: 'testnet' as NetworkId,
            mina: minaRpcUrl,
        };

        // Init mina creds

        const minaSenderPrivateKey = PrivateKey.fromBase58(
            minaSenderPrivateKeyBase58
        );
        const minaSenderPublicKey = minaSenderPrivateKey.toPublicKey();

        const smartContractPrivateKey = PrivateKey.random();
        const smartContractAddress = smartContractPrivateKey.toPublicKey();

        const Network = Mina.Network(minaConfig);
        Mina.setActiveInstance(Network);

        // compile eth verifier VK
        const ethVerifierVk = await EthVerifier.compile();
        console.log('Compile eth verifier', {
            data: ethVerifierVk.verificationKey.data,
            hash: ethVerifierVk.verificationKey.hash.toString(),
        });

        // compile contract
        const vk =
            await CodeChallengeMerkleAndEthVerifierSmartContract.compile();

        const { verificationKey } = vk;
        console.log(
            'Compiled code challenge merkle and eth verifier smart contract',
            {
                data: verificationKey.data,
                hash: verificationKey.hash.toString(),
            }
        );

        const codeChallengeMerkleAndEthVerifierSmartContract =
            new CodeChallengeMerkleAndEthVerifierSmartContract(
                smartContractAddress
            );

        const deployTx = await Mina.transaction(
            { sender: minaSenderPublicKey, fee: 0.1 * 1e9 },
            async () => {
                AccountUpdate.fundNewAccount(minaSenderPublicKey);

                // Deploy CodeChallengeSmartContract
                await codeChallengeMerkleAndEthVerifierSmartContract.deploy();
            }
        );

        console.log('Deploy transaction created. Proving...');
        await deployTx.prove();

        console.log('Transaction proved. Signing and sending...');
        const tx = await deployTx
            .sign([
                minaSenderPrivateKey,
                smartContractPrivateKey,
                //noriTokenControllerPrivateKey,
                //tokenBasePrivateKey,
            ])
            .send();

        const deployResult = await tx.wait();
        console.log(
            'Deployed code challenge merkle and eth verifier contract.',
            deployResult
        );

        // START MAIN FLOW

        // Eth details
        const ethAddressLowerHex =
            '0xC7e910807Dd2E3F49B34EfE7133cfb684520Da69'.toLowerCase();
        const depositBlockNumber = 4432732;

        const codeVerifierPKARMStr =
            '28929899377588420303953682814589874820844405496387980906819951860414692093779';
        const codeChallengePKARMStr =
            '15354345367044214131600935236508205003561151324062168867145984717473184332138';

        const codeChallengeBigInt = BigInt(codeChallengePKARMStr);
        const codeChallengeField = new Field(codeChallengeBigInt);
        const codeChallengeFieldBEHex =
            codeChallengeFieldToBEHex(codeChallengeField);
        console.log('Computing eth verifier');

        const ethVerifierProofJsonAndDepositInput =
            await computeDepositAttestationWitnessAndEthVerifier(
                depositBlockNumber,
                ethAddressLowerHex,
                codeChallengeFieldBEHex
            );
        console.log('Doing the code challenge merkle and eth verifier tx');

        const codeChallengeTx = await Mina.transaction(
            { sender: minaSenderPublicKey, fee: 0.1 * 1e9 },
            async () => {
                // Reconstruct ethVerifierProof
                const ethVerifierProof = await EthProofType.fromJSON(
                    ethVerifierProofJsonAndDepositInput.ethVerifierProofJson
                );

                // Reconstruct deposit input
                const merkleTreeContractDepositAttestorInput =
                    buildMerkleTreeContractDepositAttestorInput(
                        ethVerifierProofJsonAndDepositInput.depositAttestationInput
                    );

                await codeChallengeMerkleAndEthVerifierSmartContract.noriMint(
                    ethVerifierProof,
                    merkleTreeContractDepositAttestorInput,
                    new Field(BigInt(codeVerifierPKARMStr))
                );
            }
        );

        const provedCodeChallengeTx = await codeChallengeTx.prove();
        const signedProvedCodeChallengeTx = await provedCodeChallengeTx
            .sign([minaSenderPrivateKey])
            .send();
        const codeChallengeResult = await signedProvedCodeChallengeTx.wait();
        console.log(
            'Did the code challenge merkle and eth verifier',
            codeChallengeResult
        );
    });
});
