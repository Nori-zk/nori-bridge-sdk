import { Logger, LogPrinter } from 'esm-iso-logger';
import {
    CacheType,
    compileAndOptionallyVerifyContracts,
    type NetworkCacheConfig,
} from '@nori-zk/o1js-zk-utils';
import {
    AccountUpdate,
    fetchAccount,
    Field,
    Mina,
    type NetworkId,
    PrivateKey,
    PublicKey,
    Transaction,
    type VerificationKey,
} from 'o1js';
import { NoriStorageInterface } from '../../NoriStorageInterface.js';
import { FungibleToken } from '../../TokenBase.js';
import { NoriTokenBridge } from '../../NoriTokenBridge.js';
import {
    buildMerkleTreeContractDepositAttestorInput,
    computeDepositAttestationWitnessAndEthVerifier,
    type MerkleTreeContractDepositAttestorInputJson,
} from '../../depositAttestation.js';
import {
    codeChallengeFieldToBEHex,
    createCodeChallenge,
    generateRecipientPublicKeyHash,
    obtainCodeVerifierFromEthSignature,
    verifyCodeChallenge,
} from '../../pkarm.js';
import { noriStorageInterfaceVkHash } from '../../integrity/NoriStorageInterface.VkHash.js';
import { fungibleTokenVkHash } from '../../integrity/FungibleToken.VkHash.js';
import { noriTokenBridgeVkHash } from '../../integrity/NoriTokenBridge.VkHash.js';
import {
    NoriStorageInterfaceCacheLayout,
    FungibleTokenCacheLayout,
    NoriTokenBridgeCacheLayout,
} from '../../cache-layouts/index.js';
import { cacheFactory } from '@nori-zk/o1js-zk-utils';

void NoriTokenBridgeCacheLayout;

new LogPrinter('TokenBridgeWorker');
const logger = new Logger('TokenBridgeWorker');

export function isBrowser(): boolean {
    return (
        typeof self !== 'undefined' &&
        ((typeof window !== 'undefined' &&
            typeof window.document !== 'undefined') || // main thread
            (typeof self !== 'undefined' &&
                'importScripts' in self &&
                typeof self.importScripts === 'function')) // worker
    );
}

logger.log('Constructing TokenBridgeWorker. isBrowser:', isBrowser());

export class TokenBridgeWorker {
    /// WALLET METHOD DONT USE IN FRONT END

    // Initialise methods
    #minaPrivateKey: PrivateKey;
    async WALLET_setMinaPrivateKey(minaPrivateKeyBase58: string) {
        if (this.#minaPrivateKey)
            throw new Error('Mina private key has already been set.');
        this.#minaPrivateKey = PrivateKey.fromBase58(minaPrivateKeyBase58);
    }

    /*private deserializeTransaction(serializedTransaction: string) {
        const { tx, blindingValues, length } = JSON.parse(
            serializedTransaction
        );
        const parsedTx = JSON.parse(tx);
        const transaction = Mina.Transaction.fromJSON(
            parsedTx
        ) as Mina.Transaction<false, false>;

        if (length !== txNew.transaction.accountUpdates.length) {
            throw new Error('New Transaction length mismatch');
        }
        if (length !== transaction.transaction.accountUpdates.length) {
            throw new Error('Serialized Transaction length mismatch');
        }
        for (let i = 0; i < length; i++) {
            transaction.transaction.accountUpdates[i].lazyAuthorization =
                txNew.transaction.accountUpdates[i].lazyAuthorization;
            if (blindingValues[i] !== '')
                (
                    transaction.transaction.accountUpdates[i]
                        .lazyAuthorization as any
                ).blindingValue = Field.fromJSON(blindingValues[i]);
        }
        return transaction;
    }*/

    /*private deserializeTransaction(serializedTransaction: string) {
        const txJSON = JSON.parse(serializedTransaction);
        const payload = {
            transaction,
            onlySign: true,
            feePayer: {
                fee: fee,
                memo: memo,
            },
        };
    }*/

    private deserializeTransaction(serializedTransaction: string) {
        /*const txJSON = JSON.parse(serializedTransaction);
        const payload = {
            transaction,
            onlySign: true,
            feePayer: {
                fee: fee,
                memo: memo,
            },
        };*/
        void serializedTransaction;
        return Transaction.fromJSON(serializedTransaction);
    }

    // Sign and send transaction
    // THIS DOES NOT WORK ATM
    async WALLET_signAndSend(provedTxJsonStr: string) {
        if (!this.#minaPrivateKey)
            throw new Error(
                '#minaPrivateKey is undefined please call setMinaPrivateKey first'
            );
        const tx = Transaction.fromJSON(
            provedTxJsonStr
        ) as unknown as Mina.Transaction<true, false>;
        const result = await tx.sign([this.#minaPrivateKey]).send().wait();
        return { txHash: result.hash };
    }

    // Mina setup ******************************************************************************

    async minaSetup(options: {
        networkId?: NetworkId;
        mina: string | string[];
        archive?: string | string[];
        lightnetAccountManager?: string;
        bypassTransactionLimits?: boolean;
        minaDefaultHeaders?: HeadersInit;
        archiveDefaultHeaders?: HeadersInit;
    }) {
        const Network = Mina.Network(options);
        Mina.setActiveInstance(Network);
    }

    async computeDepositAttestationWitnessAndEthVerifier(
        codeChallengePKARM: string,
        depositBlockNumber: number,
        ethAddressLowerHex: string,
        domain = 'https://pcs.nori.it.com'
    ) {
        const codeChallengeBigInt = BigInt(codeChallengePKARM);
        const codeChallengeField = new Field(codeChallengeBigInt);
        const codeChallengeFieldBEHex =
            codeChallengeFieldToBEHex(codeChallengeField);
        return computeDepositAttestationWitnessAndEthVerifier(
            depositBlockNumber,
            ethAddressLowerHex,
            codeChallengeFieldBEHex,
            domain
        );
    }

    // Storage setup ******************************************************************************

    private async fetchAccounts(accounts: PublicKey[]): Promise<void> {
        await Promise.all(
            accounts.map((addr) => fetchAccount({ publicKey: addr }))
        );
    }

    // Balance utils

    // getBalanceOf
    async getBalanceOf(
        //noriTokenBridgeAddressBase58: string,
        noriTokenBaseBase58: string,
        minaSenderPublicKeyBase58: string
    ) {
        const minaSenderPublicKey = PublicKey.fromBase58(
            minaSenderPublicKeyBase58
        );
        const noriTokenBaseAddress = PublicKey.fromBase58(noriTokenBaseBase58);
        const noriTokenBase = new FungibleToken(noriTokenBaseAddress);
        /*const storage = new NoriStorageInterface(
            minaSenderPublicKey,
            noriTokenBridge.deriveTokenId()
        );*/
        await fetchAccount({
            publicKey: minaSenderPublicKey,
            tokenId: noriTokenBase.deriveTokenId(),
        });

        const balanceOf = await noriTokenBase.getBalanceOf(minaSenderPublicKey);

        logger.log('balanceOf raw', balanceOf);
        logger.log('balanceOf string', balanceOf.toString());

        return balanceOf.toBigInt().toString();
    }

    async mintedSoFar(
        noriTokenBridgeAddressBase58: string,
        minaSenderPublicKeyBase58: string
    ) {
        const minaSenderPublicKey = PublicKey.fromBase58(
            minaSenderPublicKeyBase58
        );
        const noriTokenBridgeAddress = PublicKey.fromBase58(
            noriTokenBridgeAddressBase58
        );
        const noriTokenBridge = new NoriTokenBridge(
            noriTokenBridgeAddress
        );
        const storage = new NoriStorageInterface(
            minaSenderPublicKey,
            noriTokenBridge.deriveTokenId()
        );
        await fetchAccount({
            publicKey: minaSenderPublicKey,
            tokenId: noriTokenBridge.deriveTokenId(),
        });
        const userKeyHash = await storage.userKeyHash.fetch();
        if (!userKeyHash)
            throw new Error(
                'userKeyHash was falsey. Perhaps this account is not set up?'
            );
        const mintedSoFar = await storage.mintedSoFar.fetch();
        return mintedSoFar.toBigInt().toString();
    }

    // Determine if we need to setupStorage (as it only needs to be done once per account).
    async needsToSetupStorage(
        noriTokenBridgeAddressBase58: string,
        minaSenderPublicKeyBase58: string
    ) {
        try {
            const minaSenderPublicKey = PublicKey.fromBase58(
                minaSenderPublicKeyBase58
            );
            const noriTokenBridgeAddress = PublicKey.fromBase58(
                noriTokenBridgeAddressBase58
            );
            const noriTokenBridge = new NoriTokenBridge(
                noriTokenBridgeAddress
            );
            const storage = new NoriStorageInterface(
                minaSenderPublicKey,
                noriTokenBridge.deriveTokenId()
            );
            await fetchAccount({
                publicKey: minaSenderPublicKey,
                tokenId: noriTokenBridge.deriveTokenId(),
            });
            const userKeyHash = await storage.userKeyHash.fetch();
            if (!userKeyHash) throw new Error('userKeyHash was falsey');
            const mintedSoFar = await storage.mintedSoFar.fetch();
            logger.log('mintedSoFar', mintedSoFar.toBigInt());
            return false;
        } catch (e) {
            const error = e as Error;
            logger.log(
                `Error determining if we needed to setup storage. Going to assume that we do need to.`,
                error
            );
            // But perhaps this could error for other reasons?!
            return true;
        }
    }

    async setupStorage(
        userPublicKeyBase58: string,
        noriTokenBridgeAddressBase58: string,
        txFee: number,
        storageInterfaceVerificationKeySafe: { data: string; hashStr: string }
    ) {
        //const userPrivateKey = PrivateKey.fromBase58(userPrivateKeyBase58);
        logger.log('userPublicKeyBase58', userPublicKeyBase58);
        const userPublicKey = PublicKey.fromBase58(userPublicKeyBase58); // userPrivateKey.toPublicKey();
        const noriTokenBridgeAddress = PublicKey.fromBase58(
            noriTokenBridgeAddressBase58
        );
        const { hashStr: storageInterfaceVerificationKeyHashStr, data } =
            storageInterfaceVerificationKeySafe;
        const storageInterfaceVerificationKeyHashBigInt = BigInt(
            storageInterfaceVerificationKeyHashStr
        );
        const hash = new Field(storageInterfaceVerificationKeyHashBigInt);
        const storageInterfaceVerificationKey = { data, hash };

        logger.log(`Setting up storage for user: ${userPublicKey.toBase58()}`);

        //await fetchAccount({ publicKey: userPublicKey }); // DO we need to do this is we are not proving here???
        // FIXME do we need
        await this.fetchAccounts([userPublicKey, noriTokenBridgeAddress]);

        // Note we could have another method to not have to do this multiple times, but keeping it stateless for now.
        const noriTokenBridgeInst = new NoriTokenBridge(
            noriTokenBridgeAddress
        );

        const setupTx = await Mina.transaction(
            { sender: userPublicKey, fee: txFee },
            async () => {
                AccountUpdate.fundNewAccount(userPublicKey, 1);
                await noriTokenBridgeInst.setUpStorage(
                    userPublicKey,
                    storageInterfaceVerificationKey
                );
            }
        );

        const provedTx = await setupTx.prove();
        return provedTx.toJSON();
    }

    // This will be removed when we have a working version of WALLET_signAndSend
    async MOCK_setupStorage(
        userPublicKeyBase58: string,
        noriTokenBridgeAddressBase58: string,
        txFee: number,
        storageInterfaceVerificationKeySafe: { data: string; hashStr: string }
    ) {
        logger.log('MOCK_setupStorage called with', {
            userPublicKeyBase58,
            noriTokenBridgeAddressBase58,
            txFee,
            storageInterfaceVerificationKeySafe,
        });
        //const userPrivateKey = PrivateKey.fromBase58(userPrivateKeyBase58);
        const userPublicKey = PublicKey.fromBase58(userPublicKeyBase58); // userPrivateKey.toPublicKey();
        const noriTokenBridgeAddress = PublicKey.fromBase58(
            noriTokenBridgeAddressBase58
        );
        const { hashStr: storageInterfaceVerificationKeyHashStr, data } =
            storageInterfaceVerificationKeySafe;
        const storageInterfaceVerificationKeyHashBigInt = BigInt(
            storageInterfaceVerificationKeyHashStr
        );
        const hash = new Field(storageInterfaceVerificationKeyHashBigInt);
        const storageInterfaceVerificationKey = { data, hash };

        logger.log(`Setting up storage for user: ${userPublicKey.toBase58()}`);

        //await fetchAccount({ publicKey: userPublicKey }); // DO we need to do this is we are not proving here???
        // FIXME do we need
        await this.fetchAccounts([userPublicKey, noriTokenBridgeAddress]);
        logger.log('fetched accounts');

        // Note we could have another method to not have to do this multiple times, but keeping it stateless for now.
        const noriTokenBridgeInst = new NoriTokenBridge(
            noriTokenBridgeAddress
        );
        logger.log('got token bridge inst');

        const setupTx = await Mina.transaction(
            { sender: userPublicKey, fee: txFee },
            async () => {
                AccountUpdate.fundNewAccount(userPublicKey, 1);
                await noriTokenBridgeInst.setUpStorage(
                    userPublicKey,
                    storageInterfaceVerificationKey
                );
            }
        );

        logger.log('setup tx');

        const provedTx = await setupTx.prove();

        logger.log('provedTx', provedTx);

        logger.log('this.#minaPrivateKey', this.#minaPrivateKey);
        const tx = await provedTx.sign([this.#minaPrivateKey]).send();
        logger.log('sent');
        const result = await tx.wait();
        logger.log('result', result);
        logger.log('Storage setup completed successfully');
        return { txHash: result.hash };
    }

    // MINTER ******************************************************************************

    // Determines whether or not to set fundNewAccount to true/false within the minting functions.
    async needsToFundAccount(
        noriTokenBaseBase58: string,
        minaSenderPublicKeyBase58: string
    ) {
        const minaSenderPublicKey = PublicKey.fromBase58(
            minaSenderPublicKeyBase58
        );
        const noriTokenBaseAddress = PublicKey.fromBase58(noriTokenBaseBase58);
        const noriTokenBase = new FungibleToken(noriTokenBaseAddress);
        try {
            const fetchAccountResult = await fetchAccount({
                publicKey: minaSenderPublicKey,
                tokenId: noriTokenBase.deriveTokenId(),
            });
            logger.log(fetchAccountResult);

            if (fetchAccountResult.account === undefined) return true;
            return false;
        } catch (e: unknown) {
            logger.log(
                'We had an error fetching the account. We assume we need to fund it.',
                e instanceof Error ? e.stack : String(e)
            );
            return true;
        }
    }

    private vkToVkSafe(vk: VerificationKey) {
        const { data, hash } = vk;
        return {
            hashStr: hash.toBigInt().toString(),
            data,
        };
    }

    async compileMinterDeps(cacheServer?: string) {
        return this.compileMinterDepsNoCache(); // FORCE COMPILE WITHOUT CACHE
        //if (!cacheServer || !isBrowser()) return this.compileMinterDepsNoCache();

        logger.log('Compiling all minter dependencies [Browser]...');

        // Now fetch caches in parallel
        const noriStorageInterfaceCache = cacheFactory({
            type: CacheType.Network,
            baseUrl: cacheServer,
            path: NoriStorageInterfaceCacheLayout.name,
            files: NoriStorageInterfaceCacheLayout.files,
        } as NetworkCacheConfig);
        const fungibleTokenCache = cacheFactory({
            type: CacheType.Network,
            baseUrl: cacheServer,
            path: FungibleTokenCacheLayout.name,
            files: FungibleTokenCacheLayout.files,
        } as NetworkCacheConfig);
        const noriTokenBridgeCache = cacheFactory({
            type: CacheType.Network,
            baseUrl: cacheServer,
            path: NoriTokenBridgeCacheLayout.name,
            files: NoriTokenBridgeCacheLayout.files,
        } as NetworkCacheConfig);

        // Compile contracts sequentially in dependency order
        const noriStorageInterfaceVks =
            await compileAndOptionallyVerifyContracts(
                logger,
                [
                    {
                        name: 'NoriStorageInterface',
                        program: NoriStorageInterface,
                        integrityHash: noriStorageInterfaceVkHash,
                    },
                ],
                await noriStorageInterfaceCache
            );
        const fungibleTokenVks = await compileAndOptionallyVerifyContracts(
            logger,
            [
                {
                    name: 'FungibleToken',
                    program: FungibleToken,
                    integrityHash: fungibleTokenVkHash,
                },
            ],
            await fungibleTokenCache
        );
        const noriTokenBridgeVks = await compileAndOptionallyVerifyContracts(
            logger,
            [
                {
                    name: 'NoriTokenBridge',
                    program: NoriTokenBridge,
                    integrityHash: noriTokenBridgeVkHash,
                },
            ],
            await noriTokenBridgeCache
        );

        const compiledVks: {
            NoriStorageInterfaceVerificationKey: VerificationKey;
            FungibleTokenVerificationKey: VerificationKey;
            NoriTokenBridgeVerificationKey: VerificationKey;
        } = {
            NoriStorageInterfaceVerificationKey:
                noriStorageInterfaceVks.NoriStorageInterfaceVerificationKey,
            FungibleTokenVerificationKey:
                fungibleTokenVks.FungibleTokenVerificationKey,
            NoriTokenBridgeVerificationKey:
                noriTokenBridgeVks.NoriTokenBridgeVerificationKey,
        };

        // Convert all verification keys to safe format
        const safeVks = {} as {
            [K in keyof typeof compiledVks]: { hashStr: string; data: string };
        };
        (Object.keys(compiledVks) as Array<keyof typeof compiledVks>).forEach(
            (key) => {
                safeVks[key] = this.vkToVkSafe(compiledVks[key]);
            }
        );

        logger.log('All minter dependency contracts compiled successfully.');

        // Return safe VKs
        return {
            noriStorageInterfaceVerificationKeySafe:
                safeVks.NoriStorageInterfaceVerificationKey,
            fungibleTokenVerificationKeySafe:
                safeVks.FungibleTokenVerificationKey,
            noriTokenBridgeVerificationKeySafe:
                safeVks.NoriTokenBridgeVerificationKey,
        };
    }

    // if the cache works then deprecate this
    async compileMinterDepsNoCache() {
        logger.log('Compiling all minter dependencies...');

        const contracts = [
            {
                name: 'NoriStorageInterface',
                program: NoriStorageInterface,
                integrityHash: noriStorageInterfaceVkHash,
            },
            {
                name: 'FungibleToken',
                program: FungibleToken,
                integrityHash: fungibleTokenVkHash,
            },
            {
                name: 'NoriTokenBridge',
                program: NoriTokenBridge,
                integrityHash: noriTokenBridgeVkHash,
            },
        ] as const;

        // Compile all contracts
        const compiledVks = await compileAndOptionallyVerifyContracts(
            logger,
            contracts
        );

        // Convert all verification keys to safe format
        const safeVks = {} as {
            [K in keyof typeof compiledVks]: { hashStr: string; data: string };
        };

        (Object.keys(compiledVks) as Array<keyof typeof compiledVks>).forEach(
            (key) => {
                safeVks[key] = this.vkToVkSafe(compiledVks[key]);
            }
        );

        logger.log('All minter dependency contracts compiled successfully.');

        // Return the safe VKs along with the NoriStorageInterface hash string separately if needed
        return {
            noriStorageInterfaceVerificationKeySafe:
                safeVks.NoriStorageInterfaceVerificationKey,
            fungibleTokenVerificationKeySafe:
                safeVks.FungibleTokenVerificationKey,
            noriTokenBridgeVerificationKeySafe:
                safeVks.NoriTokenBridgeVerificationKey,
        };
    }

    async mint(
        userPublicKeyBase58: string,
        noriTokenBridgeAddressBase58: string,
        merkleTreeContractDepositAttestorInputJson: MerkleTreeContractDepositAttestorInputJson,
        codeVerifierPKARMStr: string,
        txFee: number,
        fundNewAccount: boolean
    ) {
        const userPublicKey = PublicKey.fromBase58(userPublicKeyBase58);
        const noriTokenBridgeAddress = PublicKey.fromBase58(
            noriTokenBridgeAddressBase58
        );

        // Reconstruct deposit input
        const merkleTreeContractDepositAttestorInput =
            buildMerkleTreeContractDepositAttestorInput(
                merkleTreeContractDepositAttestorInputJson
            );

        // Reconstruct codeVerifierPKARM field
        const codeVerifierPKARMBigInt = BigInt(codeVerifierPKARMStr);
        const codeVerifierPKARMField = new Field(codeVerifierPKARMBigInt);

        logger.log(`Minting tokens for user: ${userPublicKeyBase58}`);

        //await fetchAccount({ publicKey: userPublicKey }); // DO we need to do this is we are not proving here???
        await this.fetchAccounts([userPublicKey, noriTokenBridgeAddress]);

        // Note we could have another method to not have to do this multiple times, but keeping it stateless for now.
        const noriTokenBridgeInst = new NoriTokenBridge(
            noriTokenBridgeAddress
        );

        const mintTx = await Mina.transaction(
            { sender: userPublicKey, fee: txFee },
            async () => {
                if (fundNewAccount) {
                    AccountUpdate.fundNewAccount(userPublicKey, 1);
                }
                await noriTokenBridgeInst.noriMint(
                    merkleTreeContractDepositAttestorInput,
                    codeVerifierPKARMField
                );
            }
        );

        const provedTx = await mintTx.prove();

        return provedTx.toJSON();
    }

    // This will be removed when we have a working version of WALLET_signAndSend
    async MOCK_mint(
        userPublicKeyBase58: string,
        noriTokenBridgeAddressBase58: string,
        merkleTreeContractDepositAttestorInputJson: MerkleTreeContractDepositAttestorInputJson,
        codeVerifierPKARMStr: string,
        txFee: number,
        fundNewAccount: boolean
    ) {
        const userPublicKey = PublicKey.fromBase58(userPublicKeyBase58);
        const noriTokenBridgeAddress = PublicKey.fromBase58(
            noriTokenBridgeAddressBase58
        );

        // Reconstruct deposit input
        const merkleTreeContractDepositAttestorInput =
            buildMerkleTreeContractDepositAttestorInput(
                merkleTreeContractDepositAttestorInputJson
            );

        // Reconstruct codeVerifierPKARM field
        const codeVerifierPKARMBigInt = BigInt(codeVerifierPKARMStr);
        const codeVerifierPKARMField = new Field(codeVerifierPKARMBigInt);

        logger.log(`Minting tokens for user: ${userPublicKeyBase58}`);

        //await fetchAccount({ publicKey: userPublicKey }); // DO we need to do this is we are not proving here???

        // Note we could have another method to not have to do this multiple times, but keeping it stateless for now.
        const noriTokenBridgeInst = new NoriTokenBridge(
            noriTokenBridgeAddress
        );

        const mintTx = await Mina.transaction(
            { sender: userPublicKey, fee: txFee },
            async () => {
                if (fundNewAccount) {
                    AccountUpdate.fundNewAccount(userPublicKey, 1);
                }
                await noriTokenBridgeInst.noriMint(
                    merkleTreeContractDepositAttestorInput,
                    codeVerifierPKARMField
                );
            }
        );

        const provedTx = await mintTx.prove();
        const tx = await provedTx.sign([this.#minaPrivateKey]).send();
        const result = await tx.wait();
        logger.log('Minting completed successfully');

        return { txHash: result.hash };
    }

    // Compile all deps
    async compileAll(cacheServer?: string) {
        return this.compileMinterDeps(cacheServer);
    }

    // Here another MOCK for mint but split into two stages statefulMintProof and signAndSendStatefulMintProof
    // This will be removed when we have a working version of WALLET_signAndSend

    #mintProofCache: Mina.Transaction<true, false>;
    async MOCK_computeMintProofAndCache(
        userPublicKeyBase58: string,
        noriTokenBridgeAddressBase58: string,
        merkleTreeContractDepositAttestorInputJson: MerkleTreeContractDepositAttestorInputJson,
        codeVerifierPKARMStr: string,
        txFee: number,
        fundNewAccount: boolean
        //fundNewAccount = true
    ) {
        const userPublicKey = PublicKey.fromBase58(userPublicKeyBase58);
        const noriTokenBridgeAddress = PublicKey.fromBase58(
            noriTokenBridgeAddressBase58
        );

        // Reconstruct deposit input
        const merkleTreeContractDepositAttestorInput =
            buildMerkleTreeContractDepositAttestorInput(
                merkleTreeContractDepositAttestorInputJson
            );

        // Reconstruct codeVerifierPKARM field
        const codeVerifierPKARMBigInt = BigInt(codeVerifierPKARMStr);
        const codeVerifierPKARMField = new Field(codeVerifierPKARMBigInt);

        logger.log(`Minting tokens for user: ${userPublicKeyBase58}`);

        //await fetchAccount({ publicKey: userPublicKey }); // DO we need to do this is we are not proving here???
        await this.fetchAccounts([userPublicKey, noriTokenBridgeAddress]);

        // Note we could have another method to not have to do this multiple times, but keeping it stateless for now.
        const noriTokenBridgeInst = new NoriTokenBridge(
            noriTokenBridgeAddress
        );

        const mintTx = await Mina.transaction(
            { sender: userPublicKey, fee: txFee },
            async () => {
                if (fundNewAccount) {
                    AccountUpdate.fundNewAccount(userPublicKey, 1);
                }
                await noriTokenBridgeInst.noriMint(
                    merkleTreeContractDepositAttestorInput,
                    codeVerifierPKARMField
                );
            }
        );

        const provedTx = await mintTx.prove();

        this.#mintProofCache = provedTx;
    }

    async WALLET_MOCK_signAndSendMintProofCache() {
        const signedTx = this.#mintProofCache.sign([this.#minaPrivateKey]);
        logger.log('signedTx...sending', signedTx);
        const tx = await signedTx.send();
        logger.log('Sent tx...waiting', tx);
        const result = await tx.wait();
        logger.log('Awaited tx');
        return { txHash: result.hash };
    }

    // In ZkAppWorker

    // =============================
    // PKARM Helpers (serialisable)
    // =============================

    /**
     * Generate recipient public key hash (serialisable).
     * @deprecated in alpha
     */
    async PKARM_generateRecipientPublicKeyHash_Base58(
        recipientPublicKeyBase58: string
    ) {
        const recipientPublicKey = PublicKey.fromBase58(
            recipientPublicKeyBase58
        );
        const hPubK = generateRecipientPublicKeyHash(recipientPublicKey);
        return hPubK.toBigInt().toString();
    }

    /**
     * Obtain codeVerifier from ETH signature (serialisable).
     */
    async PKARM_obtainCodeVerifierFromEthSignature(ethSignatureHex: string) {
        const codeVerifier =
            obtainCodeVerifierFromEthSignature(ethSignatureHex);
        return codeVerifier.toBigInt().toString();
    }

    /**
     * Create codeChallenge from codeVerifier + recipient (serialisable).
     */
    async PKARM_createCodeChallenge(
        codeVerifierStr: string,
        recipientPublicKeyBase58: string
    ) {
        const codeVerifier = new Field(BigInt(codeVerifierStr));
        const recipientPublicKey = PublicKey.fromBase58(
            recipientPublicKeyBase58
        );
        const codeChallenge = createCodeChallenge(
            codeVerifier,
            recipientPublicKey
        );
        return codeChallenge.toBigInt().toString();
    }

    /**
     * Verify a codeChallenge against inputs (serialisable).
     */
    async PKARM_verifyCodeChallenge(
        codeVerifierStr: string,
        recipientPublicKeyBase58: string,
        codeChallengeStr: string
    ) {
        const codeVerifier = new Field(BigInt(codeVerifierStr));
        const recipientPublicKey = PublicKey.fromBase58(
            recipientPublicKeyBase58
        );
        const codeChallenge = new Field(BigInt(codeChallengeStr));
        verifyCodeChallenge(codeVerifier, recipientPublicKey, codeChallenge);
        return true; // if assert passes, no error
    }

    /**
     * Convert codeChallenge field into big-endian hex string.
     */
    async PKARM_codeChallengeToBEHex(codeChallengeStr: string) {
        const codeChallenge = new Field(BigInt(codeChallengeStr));
        return codeChallengeFieldToBEHex(codeChallenge); // 0x-prefixed hex
    }
}
