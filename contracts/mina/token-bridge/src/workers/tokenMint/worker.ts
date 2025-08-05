import { computeDepositAttestation } from '../../depositAttestation.js';
import {
    compileEcdsaEthereum,
    compileEcdsaSigPresentationVerifier,
    createEcdsaMinaCredential,
    createEcdsaSigPresentation,
    createEcdsaSigPresentationRequest,
    EnforceMaxLength,
    getSecretHashFromPresentationJson,
    ProvableEcdsaSigPresentation,
    SecretMaxLength,
} from '../../credentialAttestation.js';
import {
    EthDepositProgram,
    EthDepositProgramInput,
    EthDepositProgramProofType,
} from '../../e2ePrerequisites.js';
import { EthVerifier, ContractDepositAttestor } from '@nori-zk/o1js-zk-utils';
import {
    AccountUpdate,
    Bytes,
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
import { wordToBytes } from '@nori-zk/proof-conversion';
// FIXME make a setter for senderPublicKey and perhaps noriAddressBase58

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
        console.time('getPresentation');
        const presentationJson = await createEcdsaSigPresentation(
            presentationRequestJson,
            credentialJson,
            this.#minaPrivateKey
        );
        console.timeEnd('getPresentation'); // 46.801s
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
        console.time('compileEcdsaEthereum');
        await compileEcdsaEthereum();
        console.timeEnd('compileEcdsaEthereum'); // 1:20.330 (m:ss.mmm)

        console.time('compilePresentationVerifier');
        await compileEcdsaSigPresentationVerifier();
        console.timeEnd('compilePresentationVerifier'); // 11.507s
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
        console.time('createCredential');
        const credentialJson = await createEcdsaMinaCredential(
            ethSecretSignature,
            ethWalletAddress,
            senderPublicKey,
            secret
        );
        console.timeEnd('createCredential'); // 2:02.513 (m:ss.mmm)
        return credentialJson;
    }

    async computeEcdsaSigPresentationRequest(zkAppPublicKeyBase58: string) {
        const zkAppPublicKey = PublicKey.fromBase58(zkAppPublicKeyBase58);
        console.time('getPresentationRequest');
        const presentationRequestJson = await createEcdsaSigPresentationRequest(
            zkAppPublicKey
        );
        console.timeEnd('getPresentationRequest'); // 1.348ms
        return presentationRequestJson;
    }

    // DEPOSIT METHODS ******************************************************************************
    //attesation e2e desposit Attestation eth verifier (compile)
    //ethDepositProof

    async compileEthDepositProgramDeps() {
        console.time('ContractDepositAttestor compile');
        const { verificationKey: contractDepositAttestorVerificationKey } =
            await ContractDepositAttestor.compile({ forceRecompile: true });
        console.timeEnd('ContractDepositAttestor compile');
        console.log(
            `ContractDepositAttestor contract compiled vk: '${contractDepositAttestorVerificationKey.hash}'.`
        );

        console.time('EthVerifier compile');
        const { verificationKey: ethVerifierVerificationKey } =
            await EthVerifier.compile({ forceRecompile: true });
        console.timeEnd('EthVerifier compile');
        console.log(
            `EthVerifier compiled vk: '${ethVerifierVerificationKey.hash}'.`
        );
        // EthDepositProgram
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
        presentationJson: string,
        depositBlockNumber: number,
        ethAddressLowerHex: string
    ) {
        const { credentialAttestationBEHex, credentialAttestationHashField } =
            getSecretHashFromPresentationJson(presentationJson);

        const { depositAttestationProof, ethVerifierProof, despositSlotRaw } =
            await computeDepositAttestation(
                depositBlockNumber,
                ethAddressLowerHex,
                credentialAttestationBEHex
            );

        const e2ePrerequisitesInput = new EthDepositProgramInput({
            credentialAttestationHash: credentialAttestationHashField,
        });

        console.log('Computing e2e');
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

    async setupStorage(
        userPublicKeyBase58: string,
        noriAddressBase58: string,
        txFee: number,
        storageInterfaceVerificationKeySafe: { data: string; hashStr: string }
    ) {
        //const userPrivateKey = PrivateKey.fromBase58(userPrivateKeyBase58);
        const userPublicKey = PublicKey.fromBase58(userPublicKeyBase58); // userPrivateKey.toPublicKey();
        const noriAddress = PublicKey.fromBase58(noriAddressBase58);
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
        await this.fetchAccounts([userPublicKey, noriAddress]);

        // Note we could have another method to not have to do this multiple times, but keeping it stateless for now.
        const noriTokenControllerInst = new NoriTokenController(noriAddress);

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

        /*await setupTx.prove();
        setupTx.toJSON()

        const tx = await setupTx.sign([userPrivateKey]).send();
        const result = await tx.wait();

        console.log('Storage setup completed successfully');
        return { txHash: result.hash };*/
    }

    async MOCK_setupStorage(
        userPublicKeyBase58: string,
        noriAddressBase58: string,
        txFee: number,
        storageInterfaceVerificationKeySafe: { data: string; hashStr: string }
    ) {
        //const userPrivateKey = PrivateKey.fromBase58(userPrivateKeyBase58);
        const userPublicKey = PublicKey.fromBase58(userPublicKeyBase58); // userPrivateKey.toPublicKey();
        const noriAddress = PublicKey.fromBase58(noriAddressBase58);
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
        await this.fetchAccounts([userPublicKey, noriAddress]);

        // Note we could have another method to not have to do this multiple times, but keeping it stateless for now.
        const noriTokenControllerInst = new NoriTokenController(noriAddress);

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

    async compileMinterDeps() {
        console.time('compileNoriStorageInterface');
        const { verificationKey: noriStorageInterfaceVerificationKey } =
            await NoriStorageInterface.compile();
        console.timeEnd('compileNoriStorageInterface');
        console.log(
            `NoriStorageInterface compiled vk: '${noriStorageInterfaceVerificationKey.hash}'.`
        );

        console.time('compileFungibleToken');
        const { verificationKey: fungibleTokenVerificationKey } =
            await FungibleToken.compile();
        console.timeEnd('compileFungibleToken');
        console.log(
            `FungibleToken compiled vk: '${fungibleTokenVerificationKey.hash}'.`
        );

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
        noriAddressBase58: string,
        proofDataJson: MintProofDataJson,
        //userPrivateKey: PrivateKey,
        txFee: number,
        fundNewAccount = true
    ) {
        const userPublicKey = PublicKey.fromBase58(userPublicKeyBase58);
        const noriAddress = PublicKey.fromBase58(noriAddressBase58);

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
        await this.fetchAccounts([userPublicKey, noriAddress]);

        // Note we could have another method to not have to do this multiple times, but keeping it stateless for now.
        const noriTokenControllerInst = new NoriTokenController(noriAddress);

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

        /*await mintTx.prove();
        const tx = await mintTx
            .sign([this.#senderPrivateKey, userPrivateKey])
            .send();
        const result = await tx.wait();

        // Fetch updated balance
        await fetchAccount({
            publicKey: userPublicKey,
            tokenId: this.#tokenBase.deriveTokenId(),
        });

        const balance = await this.#tokenBase.getBalanceOf(userPublicKey);

        console.log('Minting completed successfully');

        if (this.#isMintProofData(proofData)) {
            return {
                txHash: result.hash,
                mintedAmount:
                    proofData.ethDepositProof.publicOutput.totalLocked.toString(),
                userBalance: balance.toString(),
            };
        } else {
            return {
                txHash: result.hash,
                mintedAmount:
                    proofData.depositAttesterProof?.lockedSoFar.toString(),
                userBalance: balance.toString(),
            };
        }*/
    }

    async MOCK_mint(
        userPublicKeyBase58: string,
        noriAddressBase58: string,
        proofDataJson: MintProofDataJson,
        //userPrivateKey: PrivateKey,
        txFee: number,
        fundNewAccount = true
    ) {
        const userPublicKey = PublicKey.fromBase58(userPublicKeyBase58);
        const noriAddress = PublicKey.fromBase58(noriAddressBase58);

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
        await this.fetchAccounts([userPublicKey, noriAddress]);

        // Note we could have another method to not have to do this multiple times, but keeping it stateless for now.
        const noriTokenControllerInst = new NoriTokenController(noriAddress);

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

        // Fetch updated balance
        /*await fetchAccount({
            publicKey: userPublicKey,
            tokenId: noriTokenControllerInst.deriveTokenId(),
        });*/

        //const balance = await this.#tokenBase.getBalanceOf(userPublicKey);

        console.log('Minting completed successfully');

        return { txHash: result.hash };
    }

    // Not sure if the wallet should do this.... or the worker FIXME
    /*async send(signedAndProvedTxJsonStr: string) {
        const tx = Transaction.fromJSON(
            JSON.parse(signedAndProvedTxJsonStr) as any
        ) as unknown as Mina.Transaction<true, true>;
        //throw new Error('theres not fucking way this is gonna work lol');
        const result = await tx.send().wait();
        return { txHash: result.hash };
    }*/

    async compileAll() {
        await this.compileCredentialDeps();
        await this.compileEthDepositProgramDeps();
        return this.compileMinterDeps();
    }
}
