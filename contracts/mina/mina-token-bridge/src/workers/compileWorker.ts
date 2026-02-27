import { createTimer, decodeConsensusMptProof, EthInput, NodeProofLeft, Bytes32FieldPair } from '@nori-zk/o1js-zk-utils';
import { LogPrinter, Logger } from 'esm-iso-logger';
import {
    AccountUpdate,
    Bool,
    fetchAccount,
    Field,
    type JsonProof,
    Mina,
    type NetworkId,
    PrivateKey,
    PublicKey,
    UInt8,
    UInt64,
    type VerificationKey,
} from 'o1js';
import { NoriTokenBridge } from '../NoriTokenBridge.js';
import { NoriStorageInterface } from '../NoriStorageInterface.js';
import { FungibleToken } from '../TokenBase.js';
import {
    buildMerkleTreeContractDepositAttestorInput,
    type MerkleTreeContractDepositAttestorInputJson,
} from '../depositAttestation.js';
import {
    obtainCodeVerifierFromEthSignature,
    createCodeChallenge,
    codeChallengeFieldToBEHex,
    verifyCodeChallenge,
} from '../pkarm.js';
import seriesExample1 from '../test_examples/9578560/index.js';

new LogPrinter('CompileWorker');
const logger = new Logger('CompileWorker');

// ---------------------------------------------------------------------------
// Serialisable VK type (safe to transfer over the worker boundary)
// ---------------------------------------------------------------------------
export type VkSafe = { data: string; hashStr: string };

// ---------------------------------------------------------------------------
// Return type for compile()
// ---------------------------------------------------------------------------
export type CompileResult = {
    storageInterfaceVKSafe: VkSafe;
    fungibleTokenVKSafe: VkSafe;
    noriTokenBridgeVKSafe: VkSafe;
};

// ---------------------------------------------------------------------------
// Return type for deploy()
// ---------------------------------------------------------------------------
export type DeployResult = {
    txHash: string;
    noriTokenBridgeAddressBase58: string;
    tokenBaseAddressBase58: string;
};

// ---------------------------------------------------------------------------
// Return type for happyPath()
// ---------------------------------------------------------------------------
export type HappyPathResult = {
    deployTxHash: string;
    updateTxHash: string;
    setUpStorageTxHash: string;
    noriMintTxHash: string;
    noriTokenBridgeAddressBase58: string;
    tokenBaseAddressBase58: string;
    userPublicKeyBase58: string;
};

function vkToSafe(vk: VerificationKey): VkSafe {
    return { data: vk.data, hashStr: vk.hash.toBigInt().toString() };
}

function safeToVk(safe: VkSafe): VerificationKey {
    return { data: safe.data, hash: Field(BigInt(safe.hashStr)) };
}

async function fetchAccounts(accounts: PublicKey[]): Promise<void> {
    await Promise.all(accounts.map((pk) => fetchAccount({ publicKey: pk })));
}

// ---------------------------------------------------------------------------

export class CompileWorker {
    // -------------------------------------------------------------------------
    // Stored VKs (populated after compile())
    // -------------------------------------------------------------------------
    #storageInterfaceVK: VerificationKey | undefined;
    #fungibleTokenVK: VerificationKey | undefined;
    #noriTokenBridgeVK: VerificationKey | undefined;

    constructor() {}

    // =========================================================================
    // compile() — must be called first
    // =========================================================================
    /**
     * Compile all contracts in the correct dependency order:
     *   1. NoriStorageInterface
     *   2. FungibleToken (TokenBase)
     *   3. NoriTokenBridge  (ethVerify is inlined — no EthVerifier.compile() needed)
     *
     * Returns safe (serialisable) verification keys for all three contracts.
     */
    async compile(): Promise<CompileResult> {
        logger.log('Compiling contracts');

        const timeStorage = createTimer();
        const { verificationKey: storageVK } = await NoriStorageInterface.compile();
        logger.debug(`Compiled NoriStorageInterface in ${timeStorage()}`);
        logger.info(`NoriStorageInterface verification key: ${storageVK.hash.toString()}`);
        this.#storageInterfaceVK = storageVK;

        const timeFungible = createTimer();
        const { verificationKey: fungibleVK } = await FungibleToken.compile();
        logger.debug(`Compiled FungibleToken in ${timeFungible()}`);
        logger.info(`FungibleToken verification key: ${fungibleVK.hash.toString()}`);
        this.#fungibleTokenVK = fungibleVK;

        const timeBridge = createTimer();
        const { verificationKey: bridgeVK } = await NoriTokenBridge.compile();
        logger.debug(`Compiled NoriTokenBridge in ${timeBridge()}`);
        logger.info(`NoriTokenBridge verification key: ${bridgeVK.hash.toString()}`);
        this.#noriTokenBridgeVK = bridgeVK;

        return {
            storageInterfaceVKSafe: vkToSafe(storageVK),
            fungibleTokenVKSafe: vkToSafe(fungibleVK),
            noriTokenBridgeVKSafe: vkToSafe(bridgeVK),
        };
    }

    // =========================================================================
    // minaSetup() — connect to a Mina network
    // =========================================================================
    /**
     * Configure the active Mina network.  Must be called before any on-chain
     * operations.
     *
     * @param mina        GraphQL endpoint URL (e.g. 'http://localhost:8080/graphql')
     * @param networkId   'testnet' | 'mainnet' (default: 'testnet')
     * @param lightnetAccountManager  Lightnet account-manager URL (only for local testing)
     */
    async minaSetup(options: {
        mina: string;
        networkId?: NetworkId | 'testnet';
        lightnetAccountManager?: string;
    }): Promise<void> {
        const { mina, networkId = 'testnet', lightnetAccountManager } = options;
        const Network = Mina.Network({
            networkId: networkId as NetworkId,
            mina,
            ...(lightnetAccountManager ? { lightnetAccountManager } : {}),
        });
        Mina.setActiveInstance(Network);
        logger.log(`Mina network set up: networkId=${networkId} mina=${mina}`);
    }

    // =========================================================================
    // deploy() — deploy NoriTokenBridge + FungibleToken
    // =========================================================================
    /**
     * Deploy NoriTokenBridge and FungibleToken (TokenBase) on-chain.
     *
     * MOCK version: receives private keys directly (safe only for test environments).
     *
     * @param deployerPrivateKeyBase58      Deployer account that pays fees.
     * @param adminPublicKeyBase58          Admin of NoriTokenBridge.
     * @param noriTokenBridgePrivateKeyBase58  Keypair for the NoriTokenBridge zkApp.
     * @param tokenBasePrivateKeyBase58     Keypair for the FungibleToken zkApp.
     * @param storageVKHashStr              NoriStorageInterface VK hash (bigint string).
     * @param initialStoreHashHex           32-byte hex (no 0x) of the initial store hash.
     * @param txFee                         Transaction fee in nanomina (default 0.1 MINA).
     */
    async MOCK_deploy(
        deployerPrivateKeyBase58: string,
        adminPublicKeyBase58: string,
        noriTokenBridgePrivateKeyBase58: string,
        tokenBasePrivateKeyBase58: string,
        storageVKHashStr: string,
        initialStoreHashHex: string,
        txFee = 0.1e9
    ): Promise<DeployResult> {
        logger.log('MOCK_deploy called');
        this.#requireCompiled();

        const deployerSK = PrivateKey.fromBase58(deployerPrivateKeyBase58);
        const deployerPK = deployerSK.toPublicKey();
        const adminPK = PublicKey.fromBase58(adminPublicKeyBase58);
        const bridgeSK = PrivateKey.fromBase58(noriTokenBridgePrivateKeyBase58);
        const bridgePK = bridgeSK.toPublicKey();
        const tokenSK = PrivateKey.fromBase58(tokenBasePrivateKeyBase58);
        const tokenPK = tokenSK.toPublicKey();

        await fetchAccounts([deployerPK, adminPK]);

        const noriTokenBridge = new NoriTokenBridge(bridgePK);
        const tokenBase = new FungibleToken(tokenPK);

        const storageVKHash = Field(BigInt(storageVKHashStr));
        const initialStoreHash = Bytes32FieldPair.fromBytes32(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (await import('@nori-zk/o1js-zk-utils')).Bytes32.fromHex(initialStoreHashHex) as any
        );

        logger.log('Creating deploy transaction...');
        const deployTx = await Mina.transaction(
            { sender: deployerPK, fee: txFee },
            async () => {
                // Fund: noriTokenBridge + tokenBase + tokenBase circulation tracker = 3
                AccountUpdate.fundNewAccount(deployerPK, 3);

                await noriTokenBridge.deploy({
                    adminPublicKey: adminPK,
                    tokenBaseAddress: tokenPK,
                    storageVKHash,
                    newStoreHash: initialStoreHash,
                });

                await tokenBase.deploy({
                    symbol: 'nETH',
                    src: 'https://github.com/2nori/nori-bridge-sdk',
                    allowUpdates: true,
                });

                await tokenBase.initialize(
                    bridgePK,
                    UInt8.from(6), // 6 decimal places (1 bridge unit = 1e-6 ETH)
                    Bool(false)    // not paused
                );
            }
        );

        logger.log('Proving deploy transaction...');
        await deployTx.prove();
        const sentDeploy = await deployTx
            .sign([deployerSK, bridgeSK, tokenSK])
            .send();
        const result = await sentDeploy.wait();
        logger.log(`Deploy transaction hash: ${result.hash}`);

        return {
            txHash: result.hash,
            noriTokenBridgeAddressBase58: bridgePK.toBase58(),
            tokenBaseAddressBase58: tokenPK.toBase58(),
        };
    }

    // =========================================================================
    // MOCK_update() — submit an Ethereum state-transition proof
    // =========================================================================
    /**
     * Call NoriTokenBridge.update() with an SP1 proof bundle.
     *
     * MOCK version: receives sender private key directly.
     *
     * @param senderPrivateKeyBase58          Sender (pays fee).
     * @param noriTokenBridgeAddressBase58    Deployed bridge address.
     * @param sp1PlonkProofJson               sp1PlonkProof as JSON (SP1ProofWithPublicValuesPlonkNoTee).
     * @param conversionOutputProofJson       conversionOutputProof.proofData as JsonProof.
     * @param txFee                           Transaction fee in nanomina.
     */
    async MOCK_update(
        senderPrivateKeyBase58: string,
        noriTokenBridgeAddressBase58: string,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sp1PlonkProofJson: any,
        conversionOutputProofJson: JsonProof,
        txFee = 0.1e9
    ): Promise<{ txHash: string }> {
        logger.log('MOCK_update called');
        this.#requireCompiled();

        const senderSK = PrivateKey.fromBase58(senderPrivateKeyBase58);
        const senderPK = senderSK.toPublicKey();
        const bridgePK = PublicKey.fromBase58(noriTokenBridgeAddressBase58);
        const noriTokenBridge = new NoriTokenBridge(bridgePK);

        await fetchAccounts([senderPK, bridgePK]);

        // Decode the SP1 proof → EthInput
        const decoded = decodeConsensusMptProof(sp1PlonkProofJson);
        const input = new EthInput(decoded);

        // Reconstruct the DynamicProof from JSON
        const rawProof = await NodeProofLeft.fromJSON(conversionOutputProofJson);

        logger.log('Creating update transaction...');
        const updateTx = await Mina.transaction(
            { sender: senderPK, fee: txFee },
            async () => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                await noriTokenBridge.update(input, rawProof as any);
            }
        );

        logger.log('Proving update transaction...');
        await updateTx.prove();
        const sent = await updateTx.sign([senderSK]).send();
        const result = await sent.wait();
        logger.log(`Update transaction hash: ${result.hash}`);

        return { txHash: result.hash };
    }

    // =========================================================================
    // MOCK_setUpStorage() — initialise a per-user NoriStorageInterface account
    // =========================================================================
    /**
     * Call NoriTokenBridge.setUpStorage() to create the per-user sub-account
     * under the bridge's token ID.  Must be called once per user before minting.
     *
     * MOCK version: receives user private key directly.
     *
     * @param userPrivateKeyBase58            User whose storage to set up.
     * @param noriTokenBridgeAddressBase58    Deployed bridge address.
     * @param storageInterfaceVKSafe          NoriStorageInterface VK (from compile()).
     * @param txFee                           Transaction fee in nanomina.
     */
    async MOCK_setUpStorage(
        userPrivateKeyBase58: string,
        noriTokenBridgeAddressBase58: string,
        storageInterfaceVKSafe: VkSafe,
        txFee = 0.1e9
    ): Promise<{ txHash: string }> {
        logger.log('MOCK_setUpStorage called');
        this.#requireCompiled();

        const userSK = PrivateKey.fromBase58(userPrivateKeyBase58);
        const userPK = userSK.toPublicKey();
        const bridgePK = PublicKey.fromBase58(noriTokenBridgeAddressBase58);
        const noriTokenBridge = new NoriTokenBridge(bridgePK);

        await fetchAccounts([userPK, bridgePK]);

        const storageVK = safeToVk(storageInterfaceVKSafe);

        logger.log('Creating setUpStorage transaction...');
        const setupTx = await Mina.transaction(
            { sender: userPK, fee: txFee },
            async () => {
                AccountUpdate.fundNewAccount(userPK, 1);
                await noriTokenBridge.setUpStorage(userPK, storageVK);
            }
        );

        logger.log('Proving setUpStorage transaction...');
        await setupTx.prove();
        const sent = await setupTx.sign([userSK]).send();
        const result = await sent.wait();
        logger.log(`setUpStorage transaction hash: ${result.hash}`);

        return { txHash: result.hash };
    }

    // =========================================================================
    // MOCK_noriMint() — mint nETH tokens
    // =========================================================================
    /**
     * Call NoriTokenBridge.noriMint() to mint NORI tokens for a user.
     *
     * MOCK version: receives user private key directly.
     *
     * @param userPrivateKeyBase58                  Recipient / sender (requires signature in the method).
     * @param noriTokenBridgeAddressBase58          Deployed bridge address.
     * @param tokenBaseAddressBase58                Deployed FungibleToken address.
     * @param merkleInputJson                       Deposit attestation input as JSON.
     * @param codeVerifierPKARMStr                  codeVerifier field value (bigint string).
     * @param fundNewTokenAccount                   Whether to fund a new token account for the user.
     * @param txFee                                 Transaction fee in nanomina.
     */
    async MOCK_noriMint(
        userPrivateKeyBase58: string,
        noriTokenBridgeAddressBase58: string,
        tokenBaseAddressBase58: string,
        merkleInputJson: MerkleTreeContractDepositAttestorInputJson,
        codeVerifierPKARMStr: string,
        fundNewTokenAccount = true,
        txFee = 0.1e9
    ): Promise<{ txHash: string }> {
        logger.log('MOCK_noriMint called');
        this.#requireCompiled();

        const userSK = PrivateKey.fromBase58(userPrivateKeyBase58);
        const userPK = userSK.toPublicKey();
        const bridgePK = PublicKey.fromBase58(noriTokenBridgeAddressBase58);
        const tokenPK = PublicKey.fromBase58(tokenBaseAddressBase58);
        const noriTokenBridge = new NoriTokenBridge(bridgePK);

        await fetchAccounts([userPK, bridgePK, tokenPK]);

        // Reconstruct provable types from JSON
        const merkleInput = buildMerkleTreeContractDepositAttestorInput(merkleInputJson);
        const codeVerifier = Field(BigInt(codeVerifierPKARMStr));

        logger.log('Creating noriMint transaction...');
        const mintTx = await Mina.transaction(
            { sender: userPK, fee: txFee },
            async () => {
                if (fundNewTokenAccount) {
                    AccountUpdate.fundNewAccount(userPK, 1);
                }
                await noriTokenBridge.noriMint(merkleInput, codeVerifier);
            }
        );

        logger.log('Proving noriMint transaction...');
        await mintTx.prove();
        const sent = await mintTx.sign([userSK]).send();
        const result = await sent.wait();
        logger.log(`noriMint transaction hash: ${result.hash}`);

        return { txHash: result.hash };
    }

    // =========================================================================
    // PKARM helpers (serialisable — safe over the worker boundary)
    // =========================================================================

    /**
     * Compute the codeVerifier field from a 65-byte ETH signature hex string.
     * Returns a bigint string.
     */
    async PKARM_obtainCodeVerifierFromEthSignature(
        ethSignatureHex: string
    ): Promise<string> {
        const codeVerifier = obtainCodeVerifierFromEthSignature(ethSignatureHex);
        return codeVerifier.toBigInt().toString();
    }

    /**
     * Compute the codeChallenge field from a codeVerifier + recipient Mina public key.
     * Returns a bigint string.
     */
    async PKARM_createCodeChallenge(
        codeVerifierStr: string,
        recipientPublicKeyBase58: string
    ): Promise<string> {
        const codeVerifier = Field(BigInt(codeVerifierStr));
        const recipientPK = PublicKey.fromBase58(recipientPublicKeyBase58);
        const codeChallenge = createCodeChallenge(codeVerifier, recipientPK);
        return codeChallenge.toBigInt().toString();
    }

    /**
     * Verify a codeChallenge against its inputs (throws if invalid).
     * Returns `true` if the challenge is valid.
     */
    async PKARM_verifyCodeChallenge(
        codeVerifierStr: string,
        recipientPublicKeyBase58: string,
        codeChallengeStr: string
    ): Promise<boolean> {
        const codeVerifier = Field(BigInt(codeVerifierStr));
        const recipientPK = PublicKey.fromBase58(recipientPublicKeyBase58);
        const codeChallenge = Field(BigInt(codeChallengeStr));
        verifyCodeChallenge(codeVerifier, recipientPK, codeChallenge);
        return true;
    }

    /**
     * Convert a codeChallenge field to a 0x-prefixed big-endian hex string.
     */
    async PKARM_codeChallengeToBEHex(codeChallengeStr: string): Promise<string> {
        const codeChallenge = Field(BigInt(codeChallengeStr));
        return codeChallengeFieldToBEHex(codeChallenge);
    }

    // =========================================================================
    // happyPath() — single end-to-end call for browser smoke-testing
    // =========================================================================
    /**
     * Run the complete happy-path flow inside the worker using Lightnet and
     * the bundled test_examples.  Suitable as a browser smoke-test.
     *
     * Steps:
     *   1. minaSetup (Lightnet defaults)
     *   2. compile()
     *   3. Generate fresh keypairs for bridge, token, and user
     *   4. MOCK_deploy()
     *   5. MOCK_update() with seriesExample1 (first block)
     *   6. MOCK_setUpStorage() for the user
     *   7. MOCK_noriMint() with a synthetic deposit
     *
     * @param deployerPrivateKeyBase58  Funded account that pays for all transactions.
     * @param adminPublicKeyBase58      Admin key for the bridge contract.
     * @param minaUrl                   Mina GraphQL URL (default: Lightnet localhost).
     * @param lightnetAccountManager    Lightnet account manager URL (default: localhost:8181).
     */
    async MOCK_happyPath(
        deployerPrivateKeyBase58: string,
        adminPublicKeyBase58: string,
        minaUrl = 'http://localhost:8080/graphql',
        lightnetAccountManager = 'http://localhost:8181'
    ): Promise<HappyPathResult> {
        logger.log('=== MOCK_happyPath start ===');

        // ── 1. Network setup ─────────────────────────────────────────────────
        await this.minaSetup({
            mina: minaUrl,
            networkId: 'testnet',
            lightnetAccountManager,
        });

        // ── 2. Compile ────────────────────────────────────────────────────────
        const { storageInterfaceVKSafe } = await this.compile();
        logger.log('Compilation done.');

        // ── 3. Fresh keypairs ─────────────────────────────────────────────────
        const bridgeKP = PrivateKey.randomKeypair();
        const tokenKP = PrivateKey.randomKeypair();
        const userKP = PrivateKey.randomKeypair();
        logger.log('Generated keypairs:', {
            bridge: bridgeKP.publicKey.toBase58(),
            token: tokenKP.publicKey.toBase58(),
            user: userKP.publicKey.toBase58(),
        });

        // ── 4. Prepare initial store hash from example 1 ──────────────────────
        const decoded1 = decodeConsensusMptProof(seriesExample1.sp1PlonkProof);
        const ethInput1 = new EthInput(decoded1);
        // inputStoreHash bytes → hex string for MOCK_deploy
        const inputStoreHashBytes = ethInput1.inputStoreHash.bytes;
        const initialStoreHashHex = inputStoreHashBytes
            .map((b) => b.value.toBigInt().toString(16).padStart(2, '0'))
            .join('');

        // ── 5. Deploy ─────────────────────────────────────────────────────────
        const deployResult = await this.MOCK_deploy(
            deployerPrivateKeyBase58,
            adminPublicKeyBase58,
            bridgeKP.privateKey.toBase58(),
            tokenKP.privateKey.toBase58(),
            storageInterfaceVKSafe.hashStr,
            initialStoreHashHex
        );
        logger.log('Deployed:', deployResult);

        // ── 6. Update (submit example proof 1) ───────────────────────────────
        const updateResult = await this.MOCK_update(
            deployerPrivateKeyBase58,
            deployResult.noriTokenBridgeAddressBase58,
            seriesExample1.sp1PlonkProof,
            seriesExample1.conversionOutputProof.proofData,
        );
        logger.log('Updated:', updateResult);

        // ── 7. Set up user storage ────────────────────────────────────────────
        // The user account needs funding; the deployer transfers to user first.
        // For Lightnet the user keypair already has no balance — fund it inline.
        const deployerSK = PrivateKey.fromBase58(deployerPrivateKeyBase58);
        const deployerPK = deployerSK.toPublicKey();
        await fetchAccounts([deployerPK, userKP.publicKey]);

        // Fund the user account (1 MINA) so it can pay fees
        logger.log('Funding user account...');
        const fundTx = await Mina.transaction(
            { sender: deployerPK, fee: 0.1e9 },
            async () => {
                AccountUpdate.fundNewAccount(deployerPK, 1);
                const au = AccountUpdate.createSigned(deployerPK);
                au.send({ to: userKP.publicKey, amount: 5e9 }); // 5 MINA
            }
        );
        await fundTx.prove();
        await fundTx.sign([deployerSK]).send().then((tx) => tx.wait());
        logger.log('User funded.');

        const setupResult = await this.MOCK_setUpStorage(
            userKP.privateKey.toBase58(),
            deployResult.noriTokenBridgeAddressBase58,
            storageInterfaceVKSafe
        );
        logger.log('Storage set up:', setupResult);

        // ── 8. Mint ────────────────────────────────────────────────────────────
        // Build a synthetic deposit for the user (deposit root check is commented
        // out in noriMint, so any self-consistent merkle input will pass).
        const ethSig65Hex = 'a'.repeat(130); // 65 dummy bytes — any consistent value works
        const ethAddressHex = '1234567890abcdef1234567890abcdef12345678'; // 20 dummy bytes
        const totalWei = 2_000_000_000_000n; // 2 bridge units

        const codeVerifier = obtainCodeVerifierFromEthSignature(`0x${ethSig65Hex}`);
        const codeChallenge = createCodeChallenge(codeVerifier, userKP.publicKey);
        const codeChallengeHex = codeChallenge.toBigInt().toString(16).padStart(64, '0');
        const valueHex = totalWei.toString(16).padStart(64, '0');

        // Import helpers needed to build the synthetic merkle input
        const {
            Bytes32,
            Bytes20,
            computeMerkleTreeDepthAndSize,
            getMerklePathFromLeaves,
            getMerkleZeros,
            foldMerkleLeft,
        } = await import('@nori-zk/o1js-zk-utils');
        const { ContractDeposit, MerklePath, MerkleTreeContractDepositAttestorInput, buildContractDepositLeaves } =
            await import('../depositAttestation.js');

        const deposit = new ContractDeposit({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            address: (Bytes20 as any).fromHex(ethAddressHex),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            attestationHash: (Bytes32 as any).fromHex(codeChallengeHex),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            value: (Bytes32 as any).fromHex(valueHex),
        });

        const leaves = buildContractDepositLeaves([deposit]);
        const { depth, paddedSize } = computeMerkleTreeDepthAndSize(leaves.length);
        const zeros = getMerkleZeros(depth);
        const path = getMerklePathFromLeaves([...leaves], paddedSize, depth, 0, zeros);
        const rootHash = foldMerkleLeft(leaves, paddedSize, depth, zeros);

        const merklePath = MerklePath.from([]);
        path.forEach((p) => merklePath.push(p));

        const merkleInput = new MerkleTreeContractDepositAttestorInput({
            rootHash,
            path: merklePath,
            index: UInt64.fromValue(0),
            value: deposit,
        });

        // Convert merkleInput to the JSON form expected by MOCK_noriMint
        const merkleInputJson: MerkleTreeContractDepositAttestorInputJson = {
            depositIndex: 0,
            despositSlotRaw: {
                slot_key_address: `0x${ethAddressHex}`,
                slot_nested_key_attestation_hash: `0x${codeChallengeHex}`,
                value: `0x${valueHex}`,
            },
            path: path.map((f) => f.toBigInt().toString()),
            rootHash: rootHash.toBigInt().toString(),
        };

        // Alternatively call noriMint directly with the constructed provable types (bypass JSON round-trip)
        logger.log('Creating noriMint transaction directly...');
        await fetchAccounts([userKP.publicKey, PublicKey.fromBase58(deployResult.noriTokenBridgeAddressBase58), PublicKey.fromBase58(deployResult.tokenBaseAddressBase58)]);
        const noriTokenBridge = new NoriTokenBridge(PublicKey.fromBase58(deployResult.noriTokenBridgeAddressBase58));
        const mintTx = await Mina.transaction(
            { sender: userKP.publicKey, fee: 0.1e9 },
            async () => {
                AccountUpdate.fundNewAccount(userKP.publicKey, 1);
                await noriTokenBridge.noriMint(merkleInput, codeVerifier);
            }
        );
        await mintTx.prove();
        const sentMint = await mintTx.sign([userKP.privateKey]).send();
        const mintResult = await sentMint.wait();
        logger.log(`noriMint transaction hash: ${mintResult.hash}`);

        void merkleInputJson; // suppress unused-variable warning (kept for reference / future use)

        logger.log('=== MOCK_happyPath complete ===');

        return {
            deployTxHash: deployResult.txHash,
            updateTxHash: updateResult.txHash,
            setUpStorageTxHash: setupResult.txHash,
            noriMintTxHash: mintResult.hash,
            noriTokenBridgeAddressBase58: deployResult.noriTokenBridgeAddressBase58,
            tokenBaseAddressBase58: deployResult.tokenBaseAddressBase58,
            userPublicKeyBase58: userKP.publicKey.toBase58(),
        };
    }

    // =========================================================================
    // Private helpers
    // =========================================================================

    #requireCompiled() {
        if (!this.#storageInterfaceVK || !this.#fungibleTokenVK || !this.#noriTokenBridgeVK) {
            throw new Error('compile() must be called before any on-chain operations.');
        }
    }
}
