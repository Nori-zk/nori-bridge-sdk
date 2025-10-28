/* eslint-disable @typescript-eslint/no-unused-vars */
import {
    AccountUpdate,
    Bool,
    fetchAccount,
    Field,
    Lightnet,
    Mina,
    NetworkId,
    Poseidon,
    PrivateKey,
    PublicKey,
    UInt64,
    // Keypair,
    VerificationKey,
    Permissions
} from 'o1js';
import { FungibleToken } from '../TokenBase.js';
import assert from 'node:assert';
import { NoriStorageInterface } from '../NoriStorageInterface.js';
import { NoriTokenController } from '../NoriTokenController.js';

const FEE = Number(process.env.TX_FEE || 0.1) * 1e9; // in nanomina (1 billion = 1.0 mina)
type Keypair = {
    publicKey: PublicKey;
    privateKey: PrivateKey;
};

import { EthProofType, EthVerifier } from '@nori-zk/o1js-zk-utils';
import { getTokenDeployerWorker } from '../workers/tokenDeployer/node/parent.js';
import { TokenDeployerWorker as TokenDeployerWorkerPure } from '../workers/tokenDeployer/worker.js';

describe('NoriTokenController', () => {
    // test accounts
    let deployer: Keypair, admin: Keypair, alice: Keypair, bob: Keypair;
    // contracts + keys
    let tokenBase: FungibleToken;
    let tokenBaseVK: VerificationKey;
    let tokenBaseKeypair: Keypair;
    let noriTokenController: NoriTokenController;
    let noriTokenControllerVK: VerificationKey;
    let noriTokenControllerKeypair: Keypair;
    let storageInterfaceVK: VerificationKey;
    let ethVerifierVk: VerificationKey;
    let allAccounts: PublicKey[] = [];

    beforeAll(async () => {
        // Configure Mina network
        const Network = Mina.Network({
            networkId: 'testnet' as NetworkId,
            mina: process.env.NETWORK_URL || 'http://localhost:8080/graphql ',
            lightnetAccountManager: 'http://localhost:8181',
        });
        Mina.setActiveInstance(Network);
        deployer = await Lightnet.acquireKeyPair();
        admin = await Lightnet.acquireKeyPair();
        alice = await Lightnet.acquireKeyPair();
        bob = await Lightnet.acquireKeyPair();

        tokenBaseKeypair = PrivateKey.randomKeypair();
        noriTokenControllerKeypair = PrivateKey.randomKeypair();

        tokenBase = new FungibleToken(tokenBaseKeypair.publicKey);
        noriTokenController = new NoriTokenController(
            noriTokenControllerKeypair.publicKey
        );

        console.log(`
      deployer ${deployer.publicKey.toBase58()}
      admin ${admin.publicKey.toBase58()}
      alice ${alice.publicKey.toBase58()}
      bob ${bob.publicKey.toBase58()}
      tokenBase ${tokenBaseKeypair.publicKey.toBase58()}
      noriTokenController ${noriTokenControllerKeypair.publicKey.toBase58()}
    `);

        allAccounts = [
            deployer.publicKey,
            admin.publicKey,
            alice.publicKey,
            bob.publicKey,
            tokenBaseKeypair.publicKey,
            noriTokenControllerKeypair.publicKey,
        ];
    });
    beforeEach(async () => {
        await fetchAccounts(allAccounts);
    });

    test('should deploy and initilise contracts', async () => {
        const useDeployerWorkerSubProcess = true;
        console.log('Deploying contract.');
        const TokenDeployerWorker = useDeployerWorkerSubProcess
            ? getTokenDeployerWorker()
            : TokenDeployerWorkerPure;

        const tokenDeployer = new TokenDeployerWorker();
        await tokenDeployer.minaSetup({
            networkId: 'testnet' as NetworkId,
            mina: process.env.NETWORK_URL || 'http://localhost:8080/graphql',
        });

        const deployedVks = await tokenDeployer.compile();
        const { tokenBaseAddress, noriTokenControllerAddress } =
            await tokenDeployer.deployContracts(
                deployer.privateKey.toBase58(),
                admin.publicKey.toBase58(),
                noriTokenControllerKeypair.privateKey.toBase58(),
                tokenBaseKeypair.privateKey.toBase58(),
                PrivateKey.random().toPublicKey().toBase58(),
                deployedVks.noriStorageInterfaceVerificationKeySafe,
                FEE,
                {
                    symbol: 'nETH',
                    decimals: 18,
                    allowUpdates: true,
                }
            );
        if ('signalTerminate' in tokenDeployer && typeof tokenDeployer.signalTerminate === 'function') {
            tokenDeployer.signalTerminate();
        }

        // reconstruct VKs from safe form
        ethVerifierVk = {
            data: deployedVks.ethVerifierVerificationKeySafe.data,
            hash: new Field(
                BigInt(deployedVks.ethVerifierVerificationKeySafe.hashStr)
            ),
        };
        storageInterfaceVK = {
            data: deployedVks.noriStorageInterfaceVerificationKeySafe.data,
            hash: new Field(
                BigInt(
                    deployedVks.noriStorageInterfaceVerificationKeySafe.hashStr
                )
            ),
        };
        tokenBaseVK = {
            data: deployedVks.fungibleTokenVerificationKeySafe.data,
            hash: new Field(
                BigInt(
                    deployedVks.fungibleTokenVerificationKeySafe.hashStr
                )
            ),
        };
        noriTokenControllerVK = {
            data: deployedVks.noriTokenControllerVerificationKeySafe.data,
            hash: new Field(
                BigInt(
                    deployedVks.noriTokenControllerVerificationKeySafe.hashStr
                )
            ),
        };

        if (useDeployerWorkerSubProcess) {// if true, need compile them again within currenct (main) process
            // compile ethverifier
            console.log('compiling eth verifier');
            ethVerifierVk = (await EthVerifier.compile()).verificationKey;
            console.log('compiling nori storage');

            storageInterfaceVK = (await NoriStorageInterface.compile())
                .verificationKey;
            // if (proofsEnabled) {
            console.log('compiling FungibleToken');
            tokenBaseVK = (await FungibleToken.compile()).verificationKey;

            console.log('compiling NoriTokenController');
            noriTokenControllerVK = (await NoriTokenController.compile())
                .verificationKey;
        }

    });

    test('should set up storage for Alice', async () => {
        await txSend({
            body: async () => {
                AccountUpdate.fundNewAccount(alice.publicKey, 1);
                await noriTokenController.setUpStorage(
                    alice.publicKey,
                    storageInterfaceVK
                );
            },
            sender: alice.publicKey,
            signers: [alice.privateKey],
        });
        let storage = new NoriStorageInterface(
            alice.publicKey,
            noriTokenController.deriveTokenId()
        );
        let userHash = await storage.userKeyHash.fetch(); // fetch here
        assert.equal(
            userHash.toBigInt(),
            Poseidon.hash(alice.publicKey.toFields()).toBigInt()
        );

        let mintedSoFar = await storage.mintedSoFar.fetch();
        assert.equal(mintedSoFar.toBigInt(), 0n, 'minted so far should be 0');

        let burnedSoFar = await storage.burnedSoFar.fetch();
        assert.equal(burnedSoFar.toBigInt(), 0n, 'burned so far should be 0');
    });
});

async function txSend({
    body,
    sender,
    signers,
    fee: txFee = FEE,
}: {
    body: () => Promise<void>;
    sender: PublicKey;
    signers: PrivateKey[];
    fee?: number;
}) {
    const tx = await Mina.transaction({ sender, fee: txFee }, body);
    await tx.prove();
    tx.sign(signers);
    const pendingTx = await tx.send();
    const transaction = await pendingTx.wait();
    return transaction;
}

async function fetchAccounts(accAddr: PublicKey[]) {
    await Promise.all(accAddr.map((addr) => fetchAccount({ publicKey: addr })));
}
