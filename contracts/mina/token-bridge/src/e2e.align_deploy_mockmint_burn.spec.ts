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
    // Keypair,
    VerificationKey,
} from 'o1js';
import { FungibleToken } from './TokenBase.js';
import assert from 'node:assert';
import { NoriStorageInterface } from './NoriStorageInterface.js';
import { NoriTokenController } from './NoriTokenController.js';
import { getTokenDeployerWorker } from './workers/tokenDeployer/node/parent.js';
import { TokenDeployerWorker as TokenDeployerWorkerPure } from './workers/tokenDeployer/worker.js';

const FEE = Number(process.env.TX_FEE || 0.1) * 1e9; // in nanomina (1 billion = 1.0 mina)
type Keypair = {
    publicKey: PublicKey;
    privateKey: PrivateKey;
};

describe('e2e_devnet', () => {

    test('e2e_align_mockmint_burn_devnet', async () => {
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

        // Configure Mina network
        const Network = Mina.Network({
            networkId: 'devnet' as NetworkId,
            mina: 'https://api.minascan.io/node/devnet/v1/graphql',
            archive: 'https://archive-node.devnet.nori.it.com/graphql/'
        });
        Mina.setActiveInstance(Network);
        deployer = { publicKey: PublicKey.fromBase58('B62qkFVLuf76VH3WFbCx6YGqYvBz9hR25dxbT2XUB357p24zCEpkD6X'), privateKey: PrivateKey.fromBase58('EKFGDDBBmieCgpexHw2uvtjWN42c2EuVyLM8oUV3t2wLaACUJrTX') };
        admin = { publicKey: PublicKey.fromBase58('B62qiiZLaCVbfoQYo5r3N3qTRnEyvBoyqwDXHJySNKoPU5gLxAvJEBc'), privateKey: PrivateKey.fromBase58('EKE8NyZjzR5noxzMtTXw2AoLEm9pNNaYm7fUqF2ewqE2Cf8GdQMD') };
        alice = { publicKey: PublicKey.fromBase58('B62qqj6zf4j2wjz5Vuxztud4XnAFnHZat2JeKf1FwybkrkH491tR7ZR'), privateKey: PrivateKey.fromBase58('EKFCAGT5pLcyVjX1z3yWYM7zzu2X4nLXKQ6Bcxz6u4heRf7PrB3M') };
        bob = { publicKey: PublicKey.fromBase58('B62qpTgjz8BfasX2WL4MaVsJ3xjJy7Y8tcJHDaYzvuStTZcCVSUyo6J'), privateKey: PrivateKey.fromBase58('EKEU5gQbGRKtsiZ33Pwg9QShpMmnozjFdBWhamE4b3e9rHKPncgD') };
        const eth_receiver = Field(BigInt('0x7adcb2af858e084e1ecadc6892391f1fcfcd80ba'));
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

        await fetchAccounts(allAccounts);


        //// should deploy and initilise contracts
        const useDeployerWorkerSubProcess = false;
        console.log('Deploying contract.');
        const TokenDeployerWorker = useDeployerWorkerSubProcess
            ? getTokenDeployerWorker()
            : TokenDeployerWorkerPure;

        const tokenDeployer = new TokenDeployerWorker();
        await tokenDeployer.minaSetup({
            networkId: 'devnet' as NetworkId,
            mina: 'https://api.minascan.io/node/devnet/v1/graphql',
        });

        // compile
        const deployedVks = await tokenDeployer.compile();

        // deploy
        const { tokenBaseAddress, noriTokenControllerAddress } =
            await tokenDeployer.deployContracts(
                deployer.privateKey.toBase58(),
                admin.publicKey.toBase58(),
                noriTokenControllerKeypair.privateKey.toBase58(),
                tokenBaseKeypair.privateKey.toBase58(),
                PrivateKey.random().toPublicKey().toBase58(), // EtherProcessor zkApp Address
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

        // wait for 2mins
        await new Promise(resolve => setTimeout(resolve, 60 * 1000 * 2));

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


        //// should set up storage for Alice
        console.log(`set up storage for Alice...`);
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
        console.log('');


        //// should mock mint token successfully for Alice by alignedMint
        // fetch storage account
        await fetchAccount({
            publicKey: alice.publicKey,
            tokenId: noriTokenController.deriveTokenId(),
        });
        // check balance of FT
        await fetchAccount({
            publicKey: alice.publicKey,
            tokenId: tokenBase.deriveTokenId(),
        });
        let balance0 = await tokenBase.getBalanceOf(alice.publicKey);
        console.log('balance of alice', balance0.toString());

        // exec mock-mint
        const amountToMint = Field(10 * 1e18);
        await txSend({
            body: async () => {
                AccountUpdate.fundNewAccount(alice.publicKey, 1); // for the initialization of token-holder account based on FT
                await noriTokenController.alignedMint(amountToMint);
            },
            sender: alice.publicKey,
            signers: [alice.privateKey],
        });

        // fetch storage account
        await fetchAccount({
            publicKey: alice.publicKey,
            tokenId: noriTokenController.deriveTokenId(),
        });
        // check mintedSoFar
        storage = new NoriStorageInterface(
            alice.publicKey,
            noriTokenController.deriveTokenId()
        );
        mintedSoFar = await storage.mintedSoFar.fetch();
        assert.equal(mintedSoFar.toBigInt(), amountToMint.toBigInt(), 'minted so far should be 1000');

        // check balance of FT
        await fetchAccount({
            publicKey: alice.publicKey,
            tokenId: tokenBase.deriveTokenId(),
        });
        let balance1 = await tokenBase.getBalanceOf(alice.publicKey);
        console.log('balance of alice', balance1.toString());
        assert.equal(
            balance1.sub(balance0).toBigInt(),
            amountToMint.toBigInt(),
            'balance of alice does not match minted amount'
        );



        //// should burn tokens successfully
        // fetch storage account
        storage = new NoriStorageInterface(
            alice.publicKey,
            noriTokenController.deriveTokenId()
        );
        let burnedSoFar0 = await storage.burnedSoFar.fetch();
        console.log('burnedSoFar0', burnedSoFar0.toString());

        // check balance of FT
        await fetchAccount({
            publicKey: alice.publicKey,
            tokenId: tokenBase.deriveTokenId(),
        });
        balance0 = await tokenBase.getBalanceOf(alice.publicKey);
        console.log('balance of alice', balance0.toString());

        // exec burn
        const amountToBurn = Field(2 * 1e18);
        await txSend({
            body: async () => {
                await noriTokenController.alignedLock(amountToBurn, eth_receiver);
            },
            sender: alice.publicKey,
            signers: [alice.privateKey],
        });

        // check burnedSoFar
        let burnedSoFar1 = await storage.burnedSoFar.fetch();
        console.log('burnedSoFar1', burnedSoFar1.toString());
        assert.equal(burnedSoFar1.sub(burnedSoFar0).toBigInt(), amountToBurn.toBigInt(), `burned so far should be ${amountToBurn.toBigInt()}`);

        // check balance of FT
        await fetchAccount({
            publicKey: alice.publicKey,
            tokenId: tokenBase.deriveTokenId(),
        });
        balance1 = await tokenBase.getBalanceOf(alice.publicKey);
        console.log('balance of alice', balance1.toString());
        assert.equal(
            balance0.sub(balance1).toBigInt(),
            amountToBurn.toBigInt(),
            'balance of alice does not match minted amount'
        );
    }, 1000000000);
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

    console.log(`transaction.hash: ${transaction.hash}`);

    return transaction;
}

async function fetchAccounts(accAddr: PublicKey[]) {
    await Promise.all(accAddr.map((addr) => fetchAccount({ publicKey: addr })));
}
