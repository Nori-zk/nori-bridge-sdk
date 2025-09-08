import { AccountUpdate, Field, Mina, NetworkId, PrivateKey } from 'o1js';
import {
    CodeChallengeAndMerkleSmartContract,
    computeDepositAttestationWitness,
} from './code-challenge-and-merkle.js';
import { codeChallengeFieldToBEHex } from '../micro/pkarm.js';
import { buildMerkleTreeContractDepositAttestorInput } from '../micro/depositAttestation.js';

describe('should_test_code_challenge_and_merkle', () => {
    test('should_verify_code_challenge_and_merkle', async () => {
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

        // compile contract
        const vk = await CodeChallengeAndMerkleSmartContract.compile();

        const { verificationKey } = vk;
        console.log('Compiled code challenge and merkle smart contract', {
            data: verificationKey.data,
            hash: verificationKey.hash.toString(),
        });

        const codeChallengeAndMerkleSmartContract =
            new CodeChallengeAndMerkleSmartContract(smartContractAddress);

        const deployTx = await Mina.transaction(
            { sender: minaSenderPublicKey, fee: 0.1 * 1e9 },
            async () => {
                AccountUpdate.fundNewAccount(minaSenderPublicKey);

                // Deploy CodeChallengeSmartContract
                await codeChallengeAndMerkleSmartContract.deploy();
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
        console.log('Deployed simple code challenge contract.', deployResult);

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

        const computedDepositAttestationWitness =
            await computeDepositAttestationWitness(
                depositBlockNumber,
                ethAddressLowerHex,
                codeChallengeFieldBEHex
            );

        const codeChallengeTx = await Mina.transaction(
            { sender: minaSenderPublicKey, fee: 0.1 * 1e9 },
            async () => {
                const merkleTreeContractDepositAttestorInput =
                    buildMerkleTreeContractDepositAttestorInput(
                        computedDepositAttestationWitness.depositAttestationInput
                    );

                await codeChallengeAndMerkleSmartContract.verifyMerkleAndChallenge(
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
        console.log('Did the code challenge', codeChallengeResult);
    });
});
