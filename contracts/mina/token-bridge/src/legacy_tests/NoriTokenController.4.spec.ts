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


        test("should mock mint token successfully for Alice by alignedMint", async () => {
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
            const balance0 = await tokenBase.getBalanceOf(alice.publicKey);
            console.log('balance of alice', balance0.toString());
    
            // exec mock-mint
            const amountToMint = Field(1000);
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
            let storage = new NoriStorageInterface(
                alice.publicKey,
                noriTokenController.deriveTokenId()
            );
            let mintedSoFar = await storage.mintedSoFar.fetch();
            assert.equal(mintedSoFar.toBigInt(), amountToMint.toBigInt(), 'minted so far should be 1000');
    
            // check balance of FT
            await fetchAccount({
                publicKey: alice.publicKey,
                tokenId: tokenBase.deriveTokenId(),
            });
            const balance1 = await tokenBase.getBalanceOf(alice.publicKey);
            console.log('balance of alice', balance1.toString());
            assert.equal(
                balance1.sub(balance0).toBigInt(),
                amountToMint.toBigInt(),
                'balance of alice does not match minted amount'
            );
        });
    
        test("should fail to burn token if user has not first set up storage", async () => {
            // this test is for the case when a user recieved token from who minted tokens successfully, e.g. alice transfered token to bob. 
            // Then bob tries to burn token without first setting up storage.
    
            // 1) alice transfers some token to bob.
            // check balance of FT for Alice
            await fetchAccount({
                publicKey: alice.publicKey,
                tokenId: tokenBase.deriveTokenId(),
            });
            const balance0_alice = await tokenBase.getBalanceOf(alice.publicKey);
            console.log('balance of alice', balance0_alice.toString());
            // check balance of FT for Bob, just for comparison
            await fetchAccount({
                publicKey: bob.publicKey,
                tokenId: tokenBase.deriveTokenId(),
            });
            const balance0_bob = await tokenBase.getBalanceOf(bob.publicKey);
            console.log('balance of bob', balance0_bob.toString());
            assert.equal(
                balance0_bob.toBigInt(),
                0n,
                'balance of bob should be 0'
            );
    
            const transfered_amount = new UInt64(balance0_alice.toBigInt() / 10n);
            transfered_amount.assertGreaterThan(UInt64.one, `transfered_amount must be > 1`); // >1: for the convinience of other following tests.
            await txSend({
                body: async () => {
                    await tokenBase.transfer(alice.publicKey, bob.publicKey, transfered_amount);
                },
                sender: alice.publicKey,
                signers: [alice.privateKey],
            });
            // check balance of FT for Bob, just for comparison
            await fetchAccount({
                publicKey: bob.publicKey,
                tokenId: tokenBase.deriveTokenId(),
            });
            const balance1_bob = await tokenBase.getBalanceOf(bob.publicKey);
            console.log('balance of bob', balance1_bob.toString());
            assert.equal(
                balance1_bob.toBigInt(),
                transfered_amount.toBigInt(),
                `balance of bob should be ${transfered_amount.toBigInt()}`
            );
    
            // bob tries to burn token directly without first setting up storage.
            const amountToBurn = Field(1);
            await assert.rejects(() =>
                txSend({
                    body: async () => {
                        await noriTokenController.alignedLock(amountToBurn);
                    },
                    sender: bob.publicKey,
                    signers: [bob.privateKey],
                })
            );
        });
    
        // TODO Without NoriTokenController's Singature/Proof Approval, Could users themselves succeed evilly deploying tokenholder account invalid states & permissions?
        test("should fail to burn token if user evilly sets up storage account with invalid states & permissions", async () => {
            // this test is for the case when a user recieved token from who minted tokens successfully, e.g. alice transfered token to bob. 
            // Then bob himself (EVILLY) set up storage with invalid states & permissions rather than via `noriTokenController.setUpStorage()`,
            // !!! Since NoriTokenController's private-key holder could be evil to sign approval for creation of evil storage accounts  !!!
    
            // 1) bob himself (evilly) set up storage with invalid states & permissions
            const tokenId_nori_controller = noriTokenController.deriveTokenId();
            await txSend({
                body: async () => {
                    AccountUpdate.fundNewAccount(bob.publicKey, 1);
    
                    // compose AccountUpdate
                    const acctUpt = AccountUpdate.createSigned(bob.publicKey, tokenId_nori_controller);
                    acctUpt.body.update.verificationKey = {
                        isSome: Bool(true),
                        value: storageInterfaceVK,
                    };
                    acctUpt.body.update.permissions = {
                        isSome: Bool(true),
                        value: {
                            ...Permissions.default(),
                            editState: Permissions.signature(),//!! EVIL PERMISSION !!
                            setVerificationKey:
                                Permissions.VerificationKey.impossibleDuringCurrentVersion(),
                            setPermissions: Permissions.signature(),//!! EVIL PERMISSION !!
                        },
                    };
                    AccountUpdate.setValue(
                        acctUpt.update.appState[0], //NoriStorageInterface.userKeyHash
                        Poseidon.hash(bob.publicKey.toFields())
                    );
                    AccountUpdate.setValue(
                        acctUpt.update.appState[1], //NoriStorageInterface.mintedSoFar
                        Field(0)
                    );
    
                    // TODO NEED Confirm if need token-owner's signature approval here. SHOULD NEED IT!
                    //
                    //
    
                },
                sender: bob.publicKey,
                signers: [bob.privateKey], // TODO NEED Confirm If this tx could exec successfully without token-owner's signature/proof approval.
            });
    
            await fetchAccount({
                publicKey: bob.publicKey,
                tokenId: tokenId_nori_controller,
            });
    
    
            // 2) bob tries to burn token evill, SHOULD FAIL.
            const amountToBurn = Field(1);
            await assert.rejects(() =>
                txSend({
                    body: async () => {
                        await noriTokenController.alignedLock(amountToBurn);
                    },
                    sender: bob.publicKey,
                    signers: [bob.privateKey],
                })
            );
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
