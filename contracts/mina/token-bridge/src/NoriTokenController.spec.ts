import {
    AccountUpdate,
    Bool,
    Cache,
    Field,
    Mina,
    Poseidon,
    PrivateKey,
    PublicKey,
    UInt64,
    UInt8,
    // Keypair,
    VerificationKey,
} from 'o1js';
import { FungibleToken } from './TokenBase.js';
import assert from 'node:assert';
import { NoriStorageInterface } from './NoriStorageInterface.js';
import {
    NoriTokenController,
    MockConsenusProof,
    MockDepositAttesterProof,
    MockMinaAttestationProof,
} from './NoriTokenController.js';

const proofsEnabled = true;
const fee = 1e8;
type Keypair = {
    publicKey: PublicKey;
    privateKey: PrivateKey;
};
describe('NoriTokenController', () => {
    // test accounts
    let deployer: Mina.TestPublicKey,
        admin: Mina.TestPublicKey,
        alice: Mina.TestPublicKey,
        bob: Mina.TestPublicKey,
        colin: Mina.TestPublicKey,
        dave: Mina.TestPublicKey;
    // contracts + keys
    let tokenBase: FungibleToken;
    let tokenBaseVK: VerificationKey;
    let tokenBaseKeypair: Keypair;
    let noriTokenController: NoriTokenController;
    let noriTokenControllerVK: VerificationKey;
    let noriTokenControllerKeypair: Keypair;
    let storageInterfaceVK: VerificationKey;

    beforeAll(async () => {
        // compile contracts
        storageInterfaceVK = (
            await NoriStorageInterface.compile({
                cache: Cache.FileSystem('./cache'),
            })
        ).verificationKey;
        if (proofsEnabled) {
            tokenBaseVK = (
                await FungibleToken.compile({
                    cache: Cache.FileSystem('./cache'),
                })
            ).verificationKey;

            noriTokenControllerVK = (
                await NoriTokenController.compile({
                    cache: Cache.FileSystem('./cache'),
                })
            ).verificationKey;
        }

        // setup env
        const Local = await Mina.LocalBlockchain({
            proofsEnabled,
            // enforceTransactionLimits,
        });
        Mina.setActiveInstance(Local);
        [deployer, admin, alice, bob, colin, dave] = Local.testAccounts;

        tokenBaseKeypair = PrivateKey.randomKeypair();
        tokenBase = new FungibleToken(tokenBaseKeypair.publicKey);
        noriTokenControllerKeypair = PrivateKey.randomKeypair();
        noriTokenController = new NoriTokenController(
            noriTokenControllerKeypair.publicKey
        );
        console.log(`
      deployer ${deployer.toBase58()}
      admin ${admin.toBase58()}
      alice ${alice.toBase58()}
      bob ${bob.toBase58()}
      colin ${colin.toBase58()}
      dave ${dave.toBase58()}
      tokenBase ${tokenBaseKeypair.publicKey.toBase58()}
      noriTokenController ${noriTokenControllerKeypair.publicKey.toBase58()}
    `);
    });

    test('should deploy and initilise contracts', async () => {
        const decimals = UInt8.from(18);
        await txSend({
            body: async () => {
                AccountUpdate.fundNewAccount(deployer, 3);
                await noriTokenController.deploy({
                    adminPublicKey: admin,
                    tokenBaseAddress: tokenBaseKeypair.publicKey,
                    storageVKHash: storageInterfaceVK.hash,
                    ethProcessorAddress: PrivateKey.random().toPublicKey(), // TODO: use real EthProcessor address
                });
                await tokenBase.deploy({
                    symbol: 'nETH',
                    src: 'https://github.com/MinaFoundation/mina-fungible-token/blob/main/FungibleToken.ts',
                    allowUpdates: true,
                });
                await tokenBase.initialize(
                    noriTokenControllerKeypair.publicKey,
                    decimals,
                    Bool(false) // it's safer to set to false later, after verifying controller was deployed correctly
                );
            },
            sender: deployer,
            signers: [
                deployer.key,
                noriTokenControllerKeypair.privateKey,
                tokenBaseKeypair.privateKey,
            ],
        });
        const onchainAdmin = await noriTokenController.adminPublicKey.fetch();
        assert.equal(
            onchainAdmin.toBase58(),
            admin.toBase58(),
            'admin public key does not match'
        );

        const onchainDecimals = await tokenBase.decimals.fetch();
        assert.equal(
            onchainDecimals.toString(),
            decimals.toString(),
            'decimals do not match'
        );

        console.log('initilising and deploying contracts done');
    });
    test('should set up storage for Alice', async () => {
        await txSend({
            body: async () => {
                AccountUpdate.fundNewAccount(alice, 1);
                await noriTokenController.setUpStorage(
                    alice,
                    storageInterfaceVK
                );
            },
            sender: alice,
            signers: [alice.key],
        });
        let storage = new NoriStorageInterface(
            alice,
            noriTokenController.deriveTokenId()
        );
        let userHash = await storage.userKeyHash.fetch();
        assert.equal(
            userHash.toBigInt(),
            Poseidon.hash(alice.toFields()).toBigInt()
        );

        let mintedSoFar = await storage.mintedSoFar.fetch();
        assert.equal(mintedSoFar.toBigInt(), 0n, 'minted so far should be 0');
    });

    test('should fail if we try to set up storage for the same user again', async () => {
        await assert.rejects(() =>
            txSend({
                body: async () => {
                    await noriTokenController.setUpStorage(
                        alice,
                        storageInterfaceVK
                    );
                },
                sender: alice,
                signers: [alice.key],
            })
        );
    });
    test('should fail update NoriStorage without proof', async () => {
        let storage = new NoriStorageInterface(
            alice,
            noriTokenController.deriveTokenId()
        );
        let valueBefore = await storage.mintedSoFar.fetch();
        console.log(
            'minted so far before failed update',
            valueBefore.toString()
        );
        await txSend({
            body: async () => {
                let tokenAccUpdate = AccountUpdate.createSigned(
                    alice,
                    noriTokenController.deriveTokenId()
                );

                AccountUpdate.setValue(
                    tokenAccUpdate.update.appState[1], //NoriStorageInterface.mintedSoFar
                    Field(800)
                );
                tokenBase.approve(tokenAccUpdate);
                // let tokenAccUpdate = new NoriStorageInterface(
                //   alice,
                //   noriTokenController.deriveTokenId()
                // );
                // tokenAccUpdate.mintedSoFar.set(Field(999));
            },
            sender: alice,
            signers: [alice.key, tokenBaseKeypair.privateKey],
        });
        const valueAfter = await storage.mintedSoFar.fetch();
        console.log('minted so far after failed update', valueAfter.toString());
        assert.equal(
            valueAfter.toBigInt(),
            valueBefore.toBigInt(),
            'value should not change'
        );
    });

    test('should mint tokens for Alice only once', async () => {
        const amount = Field(3000);
        const storeHash = Field(1);
        const attesterRoot = Field(2);
        const mockProof = Field(3);
        const minaAttestHash = Poseidon.hash([mockProof]);
        const ethConsensusProof = new MockConsenusProof({
            storeHash,
            attesterRoot,
        });
        const depositAttesterProof = new MockDepositAttesterProof({
            attesterRoot,
            minaAttestHash,
            lockedSoFar: amount,
        });
        const minaAttestationProof = new MockMinaAttestationProof({
            proof: mockProof,
        });
        const tx = await txSend({
            body: async () => {
                AccountUpdate.fundNewAccount(alice, 1);
                await noriTokenController.noriMint(
                    ethConsensusProof,
                    depositAttesterProof,
                    minaAttestationProof
                );
            },
            sender: alice,
            signers: [alice.key],
        });
        // console.log('tx ', tx.toPretty());
        const balance = await tokenBase.getBalanceOf(alice);
        console.log('balance of alice', balance.toString());
        assert.equal(
            balance.toBigInt(),
            amount.toBigInt(),
            'balance of alice does not match minted amount'
        );
        //it should fail to mint again with same values
        await assert.rejects(() =>
            txSend({
                body: async () => {
                    await noriTokenController.noriMint(
                        ethConsensusProof,
                        depositAttesterProof,
                        minaAttestationProof
                    );
                },
                sender: alice,
                signers: [alice.key],
            })
        );
    });

    test('should fail mint on its own', async () => {
        await assert.rejects(() =>
            txSend({
                body: async () => {
                    await tokenBase.mint(alice, UInt64.from(111));
                },
                sender: alice,
                signers: [
                    alice.key,
                    tokenBaseKeypair.privateKey,
                    noriTokenControllerKeypair.privateKey,
                ],
            })
        );
    });
    test('should mint tokens for Alice again', async () => {
        const amount = Field(4000);
        const storeHash = Field(1);
        const attesterRoot = Field(2);
        const mockProof = Field(3);
        const minaAttestHash = Poseidon.hash([mockProof]);
        const ethConsensusProof = new MockConsenusProof({
            storeHash,
            attesterRoot,
        });
        const depositAttesterProof = new MockDepositAttesterProof({
            attesterRoot,
            minaAttestHash,
            lockedSoFar: amount,
        });
        const minaAttestationProof = new MockMinaAttestationProof({
            proof: mockProof,
        });

        const balanceBefore = await tokenBase.getBalanceOf(alice);
        console.log('balance of alice before', balanceBefore.toString());
        const tx = await txSend({
            body: async () => {
                // AccountUpdate.fundNewAccount(alice, 1);
                await noriTokenController.noriMint(
                    ethConsensusProof,
                    depositAttesterProof,
                    minaAttestationProof
                );
            },
            sender: alice,
            signers: [alice.key],
        });
        // console.log('tx ', tx.toPretty());
        const balance = await tokenBase.getBalanceOf(alice);
        console.log('balance of alice after', balance.toString());
        assert.equal(
            balance.toBigInt(),
            amount.toBigInt(),
            'balance of alice does not match minted amount'
        );
    });

    test('should fail to mint tokens for Bob, without setupStorage', async () => {
        const amount = Field(5000);
        const storeHash = Field(1);
        const attesterRoot = Field(2);
        const mockProof = Field(3);
        const minaAttestHash = Poseidon.hash([mockProof]);
        const ethConsensusProof = new MockConsenusProof({
            storeHash,
            attesterRoot,
        });
        const depositAttesterProof = new MockDepositAttesterProof({
            attesterRoot,
            minaAttestHash,
            lockedSoFar: amount,
        });
        const minaAttestationProof = new MockMinaAttestationProof({
            proof: mockProof,
        });

        await assert.rejects(() =>
            txSend({
                body: async () => {
                    AccountUpdate.fundNewAccount(bob, 1);
                    await noriTokenController.noriMint(
                        ethConsensusProof,
                        depositAttesterProof,
                        minaAttestationProof
                    );
                },
                sender: bob,
                signers: [bob.key],
            })
        );
    });
});

async function txSend({
    body,
    sender,
    signers,
    fee: txFee = fee,
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
