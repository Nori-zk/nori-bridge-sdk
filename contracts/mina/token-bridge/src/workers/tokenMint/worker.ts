import { computeDepositAttestation } from '../../depositAttestation.js';
import {
    compileEcdsaEthereum,
    compileEcdsaSigPresentationVerifier,
    createEcdsaMinaCredential,
    createEcdsaSigPresentation,
    createEcdsaSigPresentationRequest,
    ProvableEcdsaSigPresentation,
} from '../../credentialAttestation.js';

import {
    EnforceMaxLength,
    getSecretHashFromPresentationJson,
    SecretMaxLength,
} from '../../credentialAttestationUtils.js';

import {
    EthDepositProgram,
    EthDepositProgramInput,
    EthDepositProgramProofType,
} from '../../EthDepositProgram.js';
import { EthVerifier, ContractDepositAttestor } from '@nori-zk/o1js-zk-utils';
import {
    AccountUpdate,
    fetchAccount,
    Field,
    Mina,
    NetworkId,
    PrivateKey,
    PublicKey,
    Transaction,
} from 'o1js';
import { NoriStorageInterface } from '../../NoriStorageInterface.js';
import { FungibleToken } from '../../TokenBase.js';
import {
    MintProofData,
    MintProofDataJson,
    NoriTokenController,
} from '../../NoriTokenController.js';
import { Presentation } from 'mina-attestations';

export class TokenMintWorker {
    /// WALLET METHOD DONT USE IN FRONT END

    // Initialise methods
    #minaPrivateKey: PrivateKey;
    async WALLET_setMinaPrivateKey(minaPrivateKeyBase58: string) {
        if (this.#minaPrivateKey)
            throw new Error('Mina private key has already been set.');
        this.#minaPrivateKey = PrivateKey.fromBase58(minaPrivateKeyBase58);
    }

    // Credential methods

    async WALLET_computeEcdsaSigPresentation(
        presentationRequestJson: string,
        credentialJson: string
    ) {
        console.log('Awaiting createEcdsaSigPresentation()');
        console.time('createEcdsaSigPresentation');
        const presentationJson = await createEcdsaSigPresentation(
            presentationRequestJson,
            credentialJson,
            this.#minaPrivateKey
        );
        console.timeEnd('createEcdsaSigPresentation'); // 46.801s
        return presentationJson;
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

    // CREDENTIAL METHODS ******************************************************************************
    //credential (compile)
    async compileCredentialDeps() {
        // Compile programs / contracts
        console.log('awaiting compileEcdsaEthereum()');
        console.time('compileEcdsaEthereum');
        await compileEcdsaEthereum();
        console.timeEnd('compileEcdsaEthereum'); // 1:20.330 (m:ss.mmm)

        console.log('awaiting compileEcdsaSigPresentationVerifier()');
        console.time('compileEcdsaSigPresentationVerifier');
        await compileEcdsaSigPresentationVerifier();
        console.timeEnd('compileEcdsaSigPresentationVerifier'); // 11.507s
    }

    // Credential methods

    async computeCredential<FixedString extends string>(
        secret: EnforceMaxLength<FixedString, SecretMaxLength>,
        ethSecretSignature: string,
        ethWalletAddress: string,
        senderPublicKeyBase58: string
    ) {
        console.log('senderPublicKeyBase58', senderPublicKeyBase58);
        const senderPublicKey = PublicKey.fromBase58(senderPublicKeyBase58);
        console.log('Awaiting createEcdsaMinaCredential()');
        console.time('createEcdsaMinaCredential');
        const credentialJson = await createEcdsaMinaCredential(
            ethSecretSignature,
            ethWalletAddress,
            senderPublicKey,
            secret
        );
        console.timeEnd('createEcdsaMinaCredential'); // 2:02.513 (m:ss.mmm)
        return credentialJson;
    }

    async computeEcdsaSigPresentationRequest(zkAppPublicKeyBase58: string) {
        const zkAppPublicKey = PublicKey.fromBase58(zkAppPublicKeyBase58);
        console.log('Awaiting createEcdsaSigPresentation()');
        console.time('createEcdsaSigPresentation');
        const presentationRequestJson = await createEcdsaSigPresentationRequest(
            zkAppPublicKey
        );
        console.timeEnd('createEcdsaSigPresentation'); // 1.348ms
        return presentationRequestJson;
    }

    // DEPOSIT METHODS ******************************************************************************
    //attesation e2e desposit Attestation eth verifier (compile)
    //ethDepositProof

    async compileEthDepositProgramDeps() {
        console.log('Compiling ContractDepositAttestor');
        console.time('ContractDepositAttestor compile');
        const { verificationKey: contractDepositAttestorVerificationKey } =
            await ContractDepositAttestor.compile({ forceRecompile: true });
        console.timeEnd('ContractDepositAttestor compile');
        console.log(
            `ContractDepositAttestor contract compiled vk: '${contractDepositAttestorVerificationKey.hash}'.`
        );

        console.log('Compiling EthVerifier');
        console.time('EthVerifier compile');
        const { verificationKey: ethVerifierVerificationKey } =
            await EthVerifier.compile({ forceRecompile: true });
        console.timeEnd('EthVerifier compile');
        console.log(
            `EthVerifier compiled vk: '${ethVerifierVerificationKey.hash}'.`
        );
        // EthDepositProgram
        console.log('Compiling EthDepositProgram');
        console.time('EthDepositProgram compile');
        const { verificationKey: EthDepositProgramVerificationKey } =
            await EthDepositProgram.compile({
                forceRecompile: true,
            });
        console.timeEnd('EthDepositProgram compile');
        console.log(
            `EthDepositProgram compiled vk: '${EthDepositProgramVerificationKey.hash}'.`
        );
    }

    async computeEthDeposit(
        presentationJsonStr: string,
        depositBlockNumber: number,
        ethAddressLowerHex: string
    ) {
        const { credentialAttestationBEHex, credentialAttestationHashField } =
            getSecretHashFromPresentationJson(presentationJsonStr);

        const { depositAttestationProof, ethVerifierProof, despositSlotRaw } =
            await computeDepositAttestation(
                depositBlockNumber,
                ethAddressLowerHex,
                credentialAttestationBEHex
            );

        const e2ePrerequisitesInput = new EthDepositProgramInput({
            credentialAttestationHash: credentialAttestationHashField,
        });

        console.log('Computing EthDepositProgram');
        console.time('EthDepositProgram.compute');
        const ethDepositProof = await EthDepositProgram.compute(
            e2ePrerequisitesInput,
            ethVerifierProof,
            depositAttestationProof
        );
        console.timeEnd('EthDepositProgram.compute');

        return {
            despositSlotRaw,
            ethDepositProofJson: ethDepositProof.proof.toJSON(),
        };
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

        const tx = await provedTx.sign([this.#minaPrivateKey]).send();
        const result = await tx.wait();

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
        proofDataJson: MintProofDataJson,
        //userPrivateKey: PrivateKey,
        txFee: number,
        fundNewAccount: boolean
    ) {
        const userPublicKey = PublicKey.fromBase58(userPublicKeyBase58);
        const noriTokenControllerAddress = PublicKey.fromBase58(
            noriTokenControllerAddressBase58
        );

        // Reconstruct MintProofData
        const { ethDepositProofJson, presentationProofStr } = proofDataJson;

        const ethDepositProof = await EthDepositProgramProofType.fromJSON(
            ethDepositProofJson
        );
        const presentationProof = ProvableEcdsaSigPresentation.from(
            Presentation.fromJSON(presentationProofStr)
        );
        const proofData: MintProofData = {
            ethDepositProof,
            presentationProof,
        };

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
                const realProofData = proofData as MintProofData;
                await noriTokenControllerInst.noriMint(
                    realProofData.ethDepositProof,
                    realProofData.presentationProof
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
        proofDataJson: MintProofDataJson,
        //userPrivateKey: PrivateKey,
        txFee: number,
        fundNewAccount: boolean
    ) {
        const userPublicKey = PublicKey.fromBase58(userPublicKeyBase58);
        const noriTokenControllerAddress = PublicKey.fromBase58(
            noriTokenControllerAddressBase58
        );

        // Reconstruct MintProofData
        const { ethDepositProofJson, presentationProofStr } = proofDataJson;

        const ethDepositProof = await EthDepositProgramProofType.fromJSON(
            ethDepositProofJson
        );
        const presentationProof = ProvableEcdsaSigPresentation.from(
            Presentation.fromJSON(presentationProofStr)
        );
        const proofData: MintProofData = {
            ethDepositProof,
            presentationProof,
        };

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
                const realProofData = proofData as MintProofData;
                await noriTokenControllerInst.noriMint(
                    realProofData.ethDepositProof,
                    realProofData.presentationProof
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
        await this.compileCredentialDeps();
        await this.compileEthDepositProgramDeps();
        return this.compileMinterDeps();
    }

    // Here another MOCK for mint but split into two stages statefulMintProof and signAndSendStatefulMintProof
    // This will be removed when we have a working version of WALLET_signAndSend

    #mintProofCache: Mina.Transaction<true, false>;
    async MOCK_computeMintProofAndCache(
        userPublicKeyBase58: string,
        noriTokenControllerAddressBase58: string,
        proofDataJson: MintProofDataJson,
        txFee: number,
        fundNewAccount: boolean
        //fundNewAccount = true
    ) {
        const userPublicKey = PublicKey.fromBase58(userPublicKeyBase58);
        const noriTokenControllerAddress = PublicKey.fromBase58(
            noriTokenControllerAddressBase58
        );

        // Reconstruct MintProofData
        const { ethDepositProofJson, presentationProofStr } = proofDataJson;

        const ethDepositProof = await EthDepositProgramProofType.fromJSON(
            ethDepositProofJson
        );
        const presentationProof = ProvableEcdsaSigPresentation.from(
            Presentation.fromJSON(presentationProofStr)
        );
        const proofData: MintProofData = {
            ethDepositProof,
            presentationProof,
        };

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
                const realProofData = proofData as MintProofData;
                await noriTokenControllerInst.noriMint(
                    realProofData.ethDepositProof,
                    realProofData.presentationProof
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
}
