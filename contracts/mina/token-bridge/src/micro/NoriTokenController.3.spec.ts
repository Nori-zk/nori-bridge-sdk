import {
    AccountUpdate,
    Bool,
    Cache,
    fetchAccount,
    Field,
    Lightnet,
    Mina,
    NetworkId,
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
import { NoriTokenController } from './NoriTokenController.js';
import { codeChallengeFieldToBEHex } from './pkarm.js';

const FEE = Number(process.env.TX_FEE || 0.1) * 1e9; // in nanomina (1 billion = 1.0 mina)
type Keypair = {
    publicKey: PublicKey;
    privateKey: PrivateKey;
};
import { EthProofType, EthVerifier } from '@nori-zk/o1js-zk-utils';
import { getNewMinaLiteNetAccountSK } from '../testUtils.js';
import { getZkAppWorker } from './workers/zkAppWorker/node/parent.js';

import { ZkAppWorker as ZkAppWorkerPure } from './workers/zkAppWorker/worker.js'; 


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
        // compile contracts

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
        // }

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
        tokenBase = new FungibleToken(tokenBaseKeypair.publicKey);
        noriTokenControllerKeypair = PrivateKey.randomKeypair();
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
        const decimals = UInt8.from(18);
        await txSend({
            body: async () => {
                AccountUpdate.fundNewAccount(deployer.publicKey, 3);
                await noriTokenController.deploy({
                    adminPublicKey: admin.publicKey,
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
            sender: deployer.publicKey,
            signers: [
                deployer.privateKey,
                noriTokenControllerKeypair.privateKey,
                tokenBaseKeypair.privateKey,
            ],
        });
        const onchainAdmin = await noriTokenController.adminPublicKey.fetch();
        assert.equal(
            onchainAdmin.toBase58(),
            admin.publicKey.toBase58(),
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
    test('should have someone mint', async () => {
        // Define litenet mina config
        const minaConfig = {
            networkId: 'devnet' as NetworkId,
            mina: 'http://localhost:8080/graphql',
        };

        // Generate a funded test private key for mina litenet
        const litenetSk = await getNewMinaLiteNetAccountSK();
        const senderPrivateKey = PrivateKey.fromBase58(litenetSk);
        const senderPrivateKeyBase58 = senderPrivateKey.toBase58();
        const senderPublicKey = senderPrivateKey.toPublicKey();
        const senderPublicKeyBase58 = senderPublicKey.toBase58();

        // START MAIN FLOW

        // Here we are going to use an existing deposit to avoid having to go through the full deployment flow.

        const codeVerifierPKARMStr =
            '28929899377588420303953682814589874820844405496387980906819951860414692093779';
        const codeChallengePKARMStr =
            '15354345367044214131600935236508205003561151324062168867145984717473184332138';

        const ethAddressLowerHex =
            '0xC7e910807Dd2E3F49B34EfE7133cfb684520Da69'.toLowerCase();
        const depositBlockNumber = 4432612;

        // INIT zkApp WORKER **************************************************
        console.log('Fetching zkApp worker.');
        const useDeployerWorkerSubProcess = true;
        const ZkAppWorker = useDeployerWorkerSubProcess
            ? getZkAppWorker()
            : ZkAppWorkerPure;

        // Compile zkAppWorker dependancies
        console.log('Compiling dependancies of zkAppWorker');
        const zkAppWorker = new ZkAppWorker();
        const zkAppWorkerReady = zkAppWorker.compileMinterDeps();

        // Get noriStorageInterfaceVerificationKeySafe from zkAppWorkerReady resolution.
        const zkWorkerVks = await zkAppWorkerReady;
        console.log('Awaited compilation of zkAppWorkerReady');

        // Compute eth verifier and deposit witness
        console.log('Computing eth verifier and calculating deposit witness.');
        const { ethVerifierProofJson, depositAttestationInput } =
            await zkAppWorker.computeDepositAttestationWitnessAndEthVerifier(
                codeChallengePKARMStr,
                depositBlockNumber,
                ethAddressLowerHex
            );
        console.log('Computed eth verifier and calculated deposit witness.');

        // PREPARE FOR MINTING **************************************************

        // Configure wallet
        // In reality we would not pass this from the main thread. We would rely on the WALLET for signatures.
        await zkAppWorker.WALLET_setMinaPrivateKey(senderPrivateKeyBase58);
        await zkAppWorker.minaSetup(minaConfig);
        console.log('Mint setup');

        // SETUP STORAGE **************************************************

        console.time('noriMinter.setupStorage');
        const { txHash: setupTxHash } = await zkAppWorker.MOCK_setupStorage(
            senderPublicKeyBase58,
            noriTokenController.address.toBase58(),
            0.1 * 1e9,
            {
                hashStr: storageInterfaceVK.hash.toString(),
                data: storageInterfaceVK.data
            }
        );

        // NOTE! ************
        // Really a client would use await zkAppWorker.setupStorage(...args) and get a provedSetupTxStr which would be submitted to the WALLET for signing
        // Currently we don't have the correct logic for emulating the wallet signAndSend method. However zkAppWorker.setupStorage should be used on the
        // frontend.
        /*const provedSetupTxStr = await zkAppWorker.setupStorage(
                        senderPublicKeyBase58,
                        noriTokenControllerAddressBase58,
                        0.1 * 1e9,
                        noriTokenControllerVerificationKeySafe
                    );
                    console.log('provedSetupTxStr', provedSetupTxStr);*/
        // MOCK for wallet behaviour
        /*const { txHash: setupTxHash } =
                    await zkAppWorker.WALLET_signAndSend(provedSetupTxStr);*/

        console.log('setupTxHash', setupTxHash);
        console.timeEnd('noriMinter.setupStorage');

        // MINT **************************************************

        console.log('Determining user funding status.');
        const needsToFundAccount = await zkAppWorker.needsToFundAccount(
            tokenBase.address.toBase58(),
            senderPublicKeyBase58
        );
        console.log('needsToFundAccount', needsToFundAccount);

        console.time('Minting');
        const { txHash: mintTxHash } = await zkAppWorker.MOCK_mint(
            senderPublicKeyBase58,
            noriTokenController.address.toBase58(),
            ethVerifierProofJson,
            depositAttestationInput,
            codeVerifierPKARMStr,
            1e9 * 0.1,
            needsToFundAccount // needsToFundAccount should resolve to be true for this test.
        );

        // NOTE! ************
        // Really a client would use await zkAppWorker.mint(...args) and get a provedMintTxStr which would be submitted to the WALLET for signing
        // Currently we don't have the correct logic for emulating the wallet signAndSend method. However zkAppWorker.mint should be used on the
        // frontend.
        /*const provedMintTxStr = await zkAppWorker.mint(
                        senderPublicKeyBase58,
                        noriTokenControllerAddressBase58, // CHECKME @Karol
                        {
                            ethDepositProofJson: ethDepositProofJson,
                            presentationProofStr: presentationJsonStr,
                        },
                        1e9 * 0.1,
                        true
                    );
                    console.log('provedMintTxStr', provedMintTxStr);*/
        // MOCK for wallet behaviour
        /*const { txHash: mintTxHash } =
                    await zkAppWorker.WALLET_signAndSend(provedMintTxStr);*/

        console.log('mintTxHash', mintTxHash);
        console.timeEnd('Minted');
        console.log('Minted!');

        // Get the amount minted so far and print it
        const mintedSoFar = await zkAppWorker.mintedSoFar(
            noriTokenController.address.toBase58(),
            senderPublicKeyBase58
        );
        console.log('mintedSoFar', mintedSoFar);

        const balanceOfUser = await zkAppWorker.getBalanceOf(
            tokenBase.address.toBase58(),
            senderPublicKeyBase58
        );
        console.log('balanceOfUser', balanceOfUser);
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
