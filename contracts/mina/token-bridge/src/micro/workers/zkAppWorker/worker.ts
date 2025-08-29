import { EthProofType, EthVerifier } from '@nori-zk/o1js-zk-utils';
import {
    AccountUpdate,
    fetchAccount,
    Field,
    JsonProof,
    Mina,
    NetworkId,
    PrivateKey,
    PublicKey,
    Transaction,
} from 'o1js';
import { NoriStorageInterface } from '../../NoriStorageInterface.js';
import { FungibleToken } from '../../TokenBase.js';
import { NoriTokenController } from '../../NoriTokenController.js';
import {
    buildMerkleTreeContractDepositAttestorInput,
    computeDepositAttestationWitnessAndEthVerifier,
    MerkleTreeContractDepositAttestorInputJson,
} from '../../../slim/depositAttestation.js';
import { codeChallengeFieldToBEHex, createCodeChallenge, generateRecipientPublicKeyHash, obtainCodeVerifierFromEthSignature, verifyCodeChallenge } from '../../pkarm.js';

export class ZkAppWorker {
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

    // Sign and send transaction
    // THIS DOES NOT WORK ATM
    async WALLET_signAndSend(provedTxJsonStr: string) {
        if (!this.#minaPrivateKey)
            throw new Error(
                '#minaPrivateKey is undefined please call setMinaPrivateKey first'
            );
        const tx = Transaction.fromJSON(
            JSON.parse(provedTxJsonStr) as any
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

    // Eth verifier methods **********************************************************************
    async compileEthVerifier() {
        console.log('Compiling EthVerifier');
        console.time('EthVerifier compile');
        const { verificationKey: ethVerifierVerificationKey } =
            await EthVerifier.compile({ forceRecompile: true });
        console.timeEnd('EthVerifier compile');
        console.log(
            `EthVerifier compiled vk: '${ethVerifierVerificationKey.hash}'.`
        );
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
        //noriTokenControllerAddressBase58: string,
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
            noriTokenController.deriveTokenId()
        );*/
        await fetchAccount({
            publicKey: minaSenderPublicKey,
            tokenId: noriTokenBase.deriveTokenId(),
        });

        const balanceOf = await noriTokenBase.getBalanceOf(minaSenderPublicKey);

        console.log('balanceOf raw', balanceOf);
        console.log('balanceOf string', balanceOf.toString());

        return balanceOf.toBigInt().toString();
    }

    async mintedSoFar(
        noriTokenControllerAddressBase58: string,
        minaSenderPublicKeyBase58: string
    ) {
        const minaSenderPublicKey = PublicKey.fromBase58(
            minaSenderPublicKeyBase58
        );
        const noriTokenControllerAddress = PublicKey.fromBase58(
            noriTokenControllerAddressBase58
        );
        const noriTokenController = new NoriTokenController(
            noriTokenControllerAddress
        );
        const storage = new NoriStorageInterface(
            minaSenderPublicKey,
            noriTokenController.deriveTokenId()
        );
        await fetchAccount({
            publicKey: minaSenderPublicKey,
            tokenId: noriTokenController.deriveTokenId(),
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
        noriTokenControllerAddressBase58: string,
        minaSenderPublicKeyBase58: string
    ) {
        try {
            const minaSenderPublicKey = PublicKey.fromBase58(
                minaSenderPublicKeyBase58
            );
            const noriTokenControllerAddress = PublicKey.fromBase58(
                noriTokenControllerAddressBase58
            );
            const noriTokenController = new NoriTokenController(
                noriTokenControllerAddress
            );
            const storage = new NoriStorageInterface(
                minaSenderPublicKey,
                noriTokenController.deriveTokenId()
            );
            await fetchAccount({
                publicKey: minaSenderPublicKey,
                tokenId: noriTokenController.deriveTokenId(),
            });
            const userKeyHash = await storage.userKeyHash.fetch();
            if (!userKeyHash) throw new Error('userKeyHash was falsey');
            const mintedSoFar = await storage.mintedSoFar.fetch();
            console.log('mintedSoFar', mintedSoFar.toBigInt());
            return false;
        } catch (e) {
            const error = e as Error;
            console.error(
                `Error determining if we needed to setup storage. Going to assume that we do need to.`,
                error
            );
            // But perhaps this could error for other reasons?!
            return true;
        }
    }

    async setupStorage(
        userPublicKeyBase58: string,
        noriTokenControllerAddressBase58: string,
        txFee: number,
        storageInterfaceVerificationKeySafe: { data: string; hashStr: string }
    ) {
        //const userPrivateKey = PrivateKey.fromBase58(userPrivateKeyBase58);
        console.log('userPublicKeyBase58', userPublicKeyBase58);
        const userPublicKey = PublicKey.fromBase58(userPublicKeyBase58); // userPrivateKey.toPublicKey();
        const noriTokenControllerAddress = PublicKey.fromBase58(
            noriTokenControllerAddressBase58
        );
        const { hashStr: storageInterfaceVerificationKeyHashStr, data } =
            storageInterfaceVerificationKeySafe;
        const storageInterfaceVerificationKeyHashBigInt = BigInt(
            storageInterfaceVerificationKeyHashStr
        );
        const hash = new Field(storageInterfaceVerificationKeyHashBigInt);
        const storageInterfaceVerificationKey = { data, hash };

        console.log(`Setting up storage for user: ${userPublicKey.toBase58()}`);

        //await fetchAccount({ publicKey: userPublicKey }); // DO we need to do this is we are not proving here???
        // FIXME do we need
        await this.fetchAccounts([userPublicKey, noriTokenControllerAddress]);

        // Note we could have another method to not have to do this multiple times, but keeping it stateless for now.
        const noriTokenControllerInst = new NoriTokenController(
            noriTokenControllerAddress
        );

        const setupTx = await Mina.transaction(
            { sender: userPublicKey, fee: txFee },
            async () => {
                AccountUpdate.fundNewAccount(userPublicKey, 1);
                await noriTokenControllerInst.setUpStorage(
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
        noriTokenControllerAddressBase58: string,
        txFee: number,
        storageInterfaceVerificationKeySafe: { data: string; hashStr: string }
    ) {
        //const userPrivateKey = PrivateKey.fromBase58(userPrivateKeyBase58);
        const userPublicKey = PublicKey.fromBase58(userPublicKeyBase58); // userPrivateKey.toPublicKey();
        const noriTokenControllerAddress = PublicKey.fromBase58(
            noriTokenControllerAddressBase58
        );
        const { hashStr: storageInterfaceVerificationKeyHashStr, data } =
            storageInterfaceVerificationKeySafe;
        const storageInterfaceVerificationKeyHashBigInt = BigInt(
            storageInterfaceVerificationKeyHashStr
        );
        const hash = new Field(storageInterfaceVerificationKeyHashBigInt);
        const storageInterfaceVerificationKey = { data, hash };

        console.log(`Setting up storage for user: ${userPublicKey.toBase58()}`);

        //await fetchAccount({ publicKey: userPublicKey }); // DO we need to do this is we are not proving here???
        // FIXME do we need
        await this.fetchAccounts([userPublicKey, noriTokenControllerAddress]);
        console.log('fetched accounts');

        // Note we could have another method to not have to do this multiple times, but keeping it stateless for now.
        const noriTokenControllerInst = new NoriTokenController(
            noriTokenControllerAddress
        );
        console.log('got token controller inst');

        const setupTx = await Mina.transaction(
            { sender: userPublicKey, fee: txFee },
            async () => {
                AccountUpdate.fundNewAccount(userPublicKey, 1);
                await noriTokenControllerInst.setUpStorage(
                    userPublicKey,
                    storageInterfaceVerificationKey
                );
            }
        );

        console.log('setup tx');

        const provedTx = await setupTx.prove();

        console.log('provedTx', provedTx);

        console.log('this.#minaPrivateKey', this.#minaPrivateKey);
        const tx = await provedTx.sign([this.#minaPrivateKey]).send();
        console.log('sent');
        const result = await tx.wait();
        console.log('result', result);
        console.log('Storage setup completed successfully');
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
            console.log(fetchAccountResult);

            if (fetchAccountResult.account === undefined) return true;
            return false;
        } catch (e: any) {
            console.log(
                'We had an error fetching the account. We assume we need to fund it.',
                e.stack
            );
            return true;
        }
    }

    async compileMinterDeps() {
        await this.compileEthVerifier();

        console.log('Compiling NoriStorageInterface');
        console.time('compileNoriStorageInterface');
        const { verificationKey: noriStorageInterfaceVerificationKey } =
            await NoriStorageInterface.compile();
        console.timeEnd('compileNoriStorageInterface');
        console.log(
            `NoriStorageInterface compiled vk: '${noriStorageInterfaceVerificationKey.hash}'.`
        );

        console.log('Compiling FungibleToken');
        console.time('compileFungibleToken');
        const { verificationKey: fungibleTokenVerificationKey } =
            await FungibleToken.compile();
        console.timeEnd('compileFungibleToken');
        console.log(
            `FungibleToken compiled vk: '${fungibleTokenVerificationKey.hash}'.`
        );

        console.log('Compiling NoriTokenController');
        console.time('compileNoriTokenController');
        const { verificationKey: noriTokenControllerVerificationKey } =
            await NoriTokenController.compile();
        console.timeEnd('compileNoriTokenController');
        console.log(
            `NoriTokenController compiled vk: '${noriTokenControllerVerificationKey.hash}'.`
        );

        const noriStorageInterfaceVerificationKeyHashField =
            noriStorageInterfaceVerificationKey.hash;
        const noriStorageInterfaceVerificationKeyHashBigInt =
            noriStorageInterfaceVerificationKeyHashField.toBigInt();
        const noriStorageInterfaceVerificationKeyHashStr =
            noriStorageInterfaceVerificationKeyHashBigInt.toString();

        return {
            data: noriStorageInterfaceVerificationKey.data,
            hashStr: noriStorageInterfaceVerificationKeyHashStr,
        };
    }

    async mint(
        userPublicKeyBase58: string,
        noriTokenControllerAddressBase58: string,
        ethVerifierProofJson: JsonProof,
        merkleTreeContractDepositAttestorInputJson: MerkleTreeContractDepositAttestorInputJson,
        codeVerifierPKARMStr: string,
        txFee: number,
        fundNewAccount: boolean
    ) {
        const userPublicKey = PublicKey.fromBase58(userPublicKeyBase58);
        const noriTokenControllerAddress = PublicKey.fromBase58(
            noriTokenControllerAddressBase58
        );

        // Reconstruct ethVerifierProof
        const ethVerifierProof = await EthProofType.fromJSON(
            ethVerifierProofJson
        );

        // Reconstruct deposit input
        const merkleTreeContractDepositAttestorInput =
            buildMerkleTreeContractDepositAttestorInput(
                merkleTreeContractDepositAttestorInputJson
            );

        // Reconstruct codeVerifierPKARM field
        const codeVerifierPKARMBigInt = BigInt(codeVerifierPKARMStr);
        const codeVerifierPKARMField = new Field(codeVerifierPKARMBigInt);

        console.log(`Minting tokens for user: ${userPublicKeyBase58}`);

        //await fetchAccount({ publicKey: userPublicKey }); // DO we need to do this is we are not proving here???
        await this.fetchAccounts([userPublicKey, noriTokenControllerAddress]);

        // Note we could have another method to not have to do this multiple times, but keeping it stateless for now.
        const noriTokenControllerInst = new NoriTokenController(
            noriTokenControllerAddress
        );

        const mintTx = await Mina.transaction(
            { sender: userPublicKey, fee: txFee },
            async () => {
                if (fundNewAccount) {
                    AccountUpdate.fundNewAccount(userPublicKey, 1);
                }
                await noriTokenControllerInst.noriMint(
                    ethVerifierProof,
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
        noriTokenControllerAddressBase58: string,
        ethVerifierProofJson: JsonProof,
        merkleTreeContractDepositAttestorInputJson: MerkleTreeContractDepositAttestorInputJson,
        codeVerifierPKARMStr: string,
        txFee: number,
        fundNewAccount: boolean
    ) {
        const userPublicKey = PublicKey.fromBase58(userPublicKeyBase58);
        const noriTokenControllerAddress = PublicKey.fromBase58(
            noriTokenControllerAddressBase58
        );

        // Reconstruct ethVerifierProof
        const ethVerifierProof = await EthProofType.fromJSON(
            ethVerifierProofJson
        );

        // Reconstruct deposit input
        const merkleTreeContractDepositAttestorInput =
            buildMerkleTreeContractDepositAttestorInput(
                merkleTreeContractDepositAttestorInputJson
            );

        // Reconstruct codeVerifierPKARM field
        const codeVerifierPKARMBigInt = BigInt(codeVerifierPKARMStr);
        const codeVerifierPKARMField = new Field(codeVerifierPKARMBigInt);

        console.log(`Minting tokens for user: ${userPublicKeyBase58}`);

        //await fetchAccount({ publicKey: userPublicKey }); // DO we need to do this is we are not proving here???

        // Note we could have another method to not have to do this multiple times, but keeping it stateless for now.
        const noriTokenControllerInst = new NoriTokenController(
            noriTokenControllerAddress
        );

        const mintTx = await Mina.transaction(
            { sender: userPublicKey, fee: txFee },
            async () => {
                if (fundNewAccount) {
                    AccountUpdate.fundNewAccount(userPublicKey, 1);
                }
                await noriTokenControllerInst.noriMint(
                    ethVerifierProof,
                    merkleTreeContractDepositAttestorInput,
                    codeVerifierPKARMField
                );
            }
        );

        const provedTx = await mintTx.prove();
        const tx = await provedTx.sign([this.#minaPrivateKey]).send();
        const result = await tx.wait();
        console.log('Minting completed successfully');

        return { txHash: result.hash };
    }

    // Compile all deps
    async compileAll() {
        return this.compileMinterDeps();
    }

    // Here another MOCK for mint but split into two stages statefulMintProof and signAndSendStatefulMintProof
    // This will be removed when we have a working version of WALLET_signAndSend

    #mintProofCache: Mina.Transaction<true, false>;
    async MOCK_computeMintProofAndCache(
        userPublicKeyBase58: string,
        noriTokenControllerAddressBase58: string,
        ethVerifierProofJson: JsonProof,
        merkleTreeContractDepositAttestorInputJson: MerkleTreeContractDepositAttestorInputJson,
        codeVerifierPKARMStr: string,
        txFee: number,
        fundNewAccount: boolean
        //fundNewAccount = true
    ) {
        const userPublicKey = PublicKey.fromBase58(userPublicKeyBase58);
        const noriTokenControllerAddress = PublicKey.fromBase58(
            noriTokenControllerAddressBase58
        );

        // Reconstruct ethVerifierProof
        const ethVerifierProof = await EthProofType.fromJSON(
            ethVerifierProofJson
        );

        // Reconstruct deposit input
        const merkleTreeContractDepositAttestorInput =
            buildMerkleTreeContractDepositAttestorInput(
                merkleTreeContractDepositAttestorInputJson
            );

        // Reconstruct codeVerifierPKARM field
        const codeVerifierPKARMBigInt = BigInt(codeVerifierPKARMStr);
        const codeVerifierPKARMField = new Field(codeVerifierPKARMBigInt);

        console.log(`Minting tokens for user: ${userPublicKeyBase58}`);

        //await fetchAccount({ publicKey: userPublicKey }); // DO we need to do this is we are not proving here???
        await this.fetchAccounts([userPublicKey, noriTokenControllerAddress]);

        // Note we could have another method to not have to do this multiple times, but keeping it stateless for now.
        const noriTokenControllerInst = new NoriTokenController(
            noriTokenControllerAddress
        );

        const mintTx = await Mina.transaction(
            { sender: userPublicKey, fee: txFee },
            async () => {
                if (fundNewAccount) {
                    AccountUpdate.fundNewAccount(userPublicKey, 1);
                }
                await noriTokenControllerInst.noriMint(
                    ethVerifierProof,
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
        console.log('signedTx...sending', signedTx);
        const tx = await signedTx.send();
        console.log('Sent tx...waiting', tx);
        const result = await tx.wait();
        console.log('Awaited tx');
        return { txHash: result.hash };
    }

    // In ZkAppWorker

    // =============================
    // PKARM Helpers (serialisable)
    // =============================

    /**
     * Generate recipient public key hash (serialisable).
     */
    async PKARM_generateRecipientPublicKeyHash_Base58(
        recipientPublicKeyBase58: string
    ) {
        const recipientPublicKey = PublicKey.fromBase58(
            recipientPublicKeyBase58
        );
        const hPubK = generateRecipientPublicKeyHash(recipientPublicKey);
        return hPubK.toBigInt().toString(); // serialisable string
    }

    /**
     * Obtain codeVerifier from ETH signature (serialisable).
     */
    async PKARM_obtainCodeVerifierFromEthSignature(ethSignatureHex: string) {
        const codeVerifier =
            obtainCodeVerifierFromEthSignature(ethSignatureHex);
        return codeVerifier.toBigInt().toString(); // serialisable string
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
        return codeChallenge.toBigInt().toString(); // serialisable string
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
        return codeChallengeFieldToBEHex(codeChallenge); // already 0x-prefixed hex
    }
}
