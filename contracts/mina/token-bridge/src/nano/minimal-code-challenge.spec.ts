import { AccountUpdate, Field, Mina, NetworkId, PrivateKey } from 'o1js';
import { CodeChallengeSmartContract } from './minimal-code-challenge.js';

describe('should_test_minimal_code_challenge', () => {
    test('should_verify_minimal_code_challenge', async () => {
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

        // compile contract
        const vk = await CodeChallengeSmartContract.compile();

        const {verificationKey} = vk;
        console.log('Compiled code challenge smart contract', {data: verificationKey.data, hash: verificationKey.hash.toString()});

        const codeChallengeSmartContract = new CodeChallengeSmartContract(
            smartContractAddress
        );

        const Network = Mina.Network(minaConfig);
        Mina.setActiveInstance(Network);

        const deployTx = await Mina.transaction(
            { sender: minaSenderPublicKey, fee: 0.1 * 1e9 },
            async () => {
                AccountUpdate.fundNewAccount(minaSenderPublicKey);

                // Deploy CodeChallengeSmartContract
                await codeChallengeSmartContract.deploy();
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

        // Use an existing deposit to avoid having to use the infrastructure
        const codeVerifierPKARMStr =
            '28929899377588420303953682814589874820844405496387980906819951860414692093779';
        const codeVerifierPKARMField = new Field(codeVerifierPKARMStr);
        const codeChallengePKARMStr =
            '15354345367044214131600935236508205003561151324062168867145984717473184332138';
        const codeChallengePKARMField = new Field(codeChallengePKARMStr);

        // Invoke a contract method

        const codeChallengeTx = await Mina.transaction(
            { sender: minaSenderPublicKey, fee: 0.1 * 1e9 },
            async () => {
                await codeChallengeSmartContract.verifyChallenge(
                    codeVerifierPKARMField,
                    codeChallengePKARMField
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
