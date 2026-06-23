import { Logger, LogPrinter } from 'esm-iso-logger';
import {
    Bytes20,
    Bytes32,
    Bytes32FieldPair,
    compileAndOptionallyVerifyContracts,
    decodeConsensusMptProof,
    EthInput,
    NodeProofLeft,
    type VerificationKeySafe,
    vkToVkSafe,
} from '@nori-zk/o1js-zk-utils';
import type {
    ProofDataOutput,
    SP1ProofWithPublicValuesPlonkNoTee,
} from '@nori-zk/proof-conversion/min';
import { FrC } from '@nori-zk/proof-conversion/min';
import {
    AccountUpdate,
    Bool,
    CircuitString,
    fetchAccount,
    Field,
    Mina,
    type NetworkId,
    Poseidon,
    PrivateKey,
    PublicKey,
    Signature,
    UInt8,
} from 'o1js';
import { NoriStorageInterface } from '../../NoriStorageInterface.js';
import { FungibleToken } from '../../TokenBase.js';
import { NoriTokenBridge } from '../../NoriTokenBridge.js';
import {
    buildMerkleTreeContractDepositAttestorInput,
    type MerkleTreeContractDepositAttestorInputJson,
} from '../../depositAttestation.js';
import { SCRAMWitness } from '../../scram.js';
import { noriStorageInterfaceVkHash } from '../../integrity/NoriStorageInterface.VkHash.js';
import { fungibleTokenVkHash } from '../../integrity/FungibleToken.VkHash.js';
import { noriTokenBridgeVkHash } from '../../integrity/NoriTokenBridge.VkHash.js';

new LogPrinter('TokenBridgeTester');
const logger = new Logger('TokenBridgeTester');

export type SafeVK = { hashStr: string; data: string };

export interface DeploymentResult {
    noriTokenBridgeAddress: string;
    tokenBaseAddress: string;
    tokenBaseTokenId: string;
    noriTokenBridgeTokenId: string;
    txHash: string;
}

export class TokenBridgeTester {

    async minaSetup(options: {
        networkId?: NetworkId;
        mina: string | string[];
        archive: string | string[];
        lightnetAccountManager?: string;
        bypassTransactionLimits?: boolean;
        minaDefaultHeaders?: HeadersInit;
        archiveDefaultHeaders?: HeadersInit;
    }) {
        const Network = Mina.Network(options);
        Mina.setActiveInstance(Network);
    }

    async compile() {
        logger.log('Compiling all contracts...');

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

        const compiledVks = await compileAndOptionallyVerifyContracts(
            logger,
            contracts
        );

        logger.log('All contracts compiled successfully.');

        return {
            noriStorageInterfaceVerificationKeySafe: vkToVkSafe(
                compiledVks.NoriStorageInterfaceVerificationKey
            ),
            fungibleTokenVerificationKeySafe: vkToVkSafe(
                compiledVks.FungibleTokenVerificationKey
            ),
            noriTokenBridgeVerificationKeySafe: vkToVkSafe(
                compiledVks.NoriTokenBridgeVerificationKey
            ),
        };
    }

    private async fetchAccounts(accounts: PublicKey[]): Promise<void> {
        await Promise.all(
            accounts.map((addr) => fetchAccount({ publicKey: addr }))
        );
    }

    // =======================================================================
    // Deployment
    // =======================================================================

    async deployContracts(
        senderPrivateKeyBase58: string,
        adminPublicKeyBase58: string,
        noriTokenBridgePrivateKeyBase58: string,
        tokenBasePrivateKeyBase58: string,
        storeHashHex: string,
        ethTokenBridgeAddressHex: string,
        genesisRootHex: string,
        storageInterfaceVerificationKeySafe: SafeVK,
        pi0: string,
        po2: string,
        txFee: number,
        options: {
            symbol?: string;
            decimals?: number;
            allowUpdates?: boolean;
            startPaused?: boolean;
        } = {}
    ): Promise<DeploymentResult> {
        const { hashStr: storageInterfaceVerificationKeyHashStr, data } =
            storageInterfaceVerificationKeySafe;
        const hash = new Field(BigInt(storageInterfaceVerificationKeyHashStr));
        const storageInterfaceVerificationKey = { data, hash };

        const adminPublicKey = PublicKey.fromBase58(adminPublicKeyBase58);
        const senderPrivateKey = PrivateKey.fromBase58(senderPrivateKeyBase58);
        const senderPublicKey = senderPrivateKey.toPublicKey();
        const ethTokenBridgeAddress = Bytes20.fromHex(
            ethTokenBridgeAddressHex
        ).toField();
        const genesisRoot = Poseidon.hash(Bytes32.fromHex(genesisRootHex).toFields());

        const noriTokenBridgePrivateKey = PrivateKey.fromBase58(
            noriTokenBridgePrivateKeyBase58
        );
        const noriTokenBridgePublicKey = noriTokenBridgePrivateKey.toPublicKey();

        const tokenBasePrivateKey = PrivateKey.fromBase58(
            tokenBasePrivateKeyBase58
        );
        const tokenBaseAddress = tokenBasePrivateKey.toPublicKey();

        const newStoreHash = Bytes32FieldPair.fromBytes32(
            Bytes32.fromHex(storeHashHex)
        );

        const symbol = options.symbol || 'nETH';
        const decimals = UInt8.from(options.decimals || 6);
        const allowUpdates = options.allowUpdates ?? true;
        const startPaused = Bool(options.startPaused ?? false);

        logger.log('Deploying NoriTokenBridge and FungibleToken contracts...');

        const noriTokenBridge = new NoriTokenBridge(noriTokenBridgePublicKey);
        const tokenBase = new FungibleToken(tokenBaseAddress);

        const deployTx = await Mina.transaction(
            { sender: senderPublicKey, fee: txFee },
            async () => {
                AccountUpdate.fundNewAccount(senderPublicKey, 3);

                await noriTokenBridge.deploy({
                    adminPublicKey,
                    tokenBaseAddress,
                    storageVKHash: storageInterfaceVerificationKey.hash,
                    newStoreHash,
                    ethTokenBridgeAddress,
                    genesisRoot,
                    noriHeliosProgramPi0: FrC.from(pi0),
                    proofConversionPO2: Field.from(po2),
                });

                await tokenBase.deploy({
                    symbol,
                    src: 'https://github.com/2nori/nori-bridge-sdk',
                    allowUpdates,
                });

                await tokenBase.initialize(
                    noriTokenBridgePublicKey,
                    decimals,
                    startPaused
                );
            }
        );

        logger.log('Deploy transaction created. Proving...');
        await deployTx.prove();

        logger.log('Transaction proved. Signing and sending...');
        const tx = await deployTx
            .sign([
                senderPrivateKey,
                noriTokenBridgePrivateKey,
                tokenBasePrivateKey,
            ])
            .send();

        const result = await tx.wait();

        logger.log('Contracts deployed successfully.');

        const tokenBaseTokenId = tokenBase.deriveTokenId().toString();
        const noriTokenBridgeTokenId = noriTokenBridge
            .deriveTokenId()
            .toString();
        logger.log(`Token Base Token ID: ${tokenBaseTokenId}`);
        logger.log(`NoriTokenBridge Token ID: ${noriTokenBridgeTokenId}`);


        return {
            noriTokenBridgeAddress: noriTokenBridge.address.toBase58(),
            tokenBaseAddress: tokenBase.address.toBase58(),
            tokenBaseTokenId,
            noriTokenBridgeTokenId,
            txHash: result.hash,
        };
    }

    async updateVerificationKeys(
        senderPrivateKeyBase58: string,
        noriTokenBridgeAddressBase58: string,
        tokenBaseAddressBase58: string,
        noriTokenBridgeVerificationKeySafe: VerificationKeySafe,
        fungibleTokenVerificationKeySafe: VerificationKeySafe,
        txFee: number,
        updateTokenBaseVK: boolean,
        updateNoriTokenBridgeVK: boolean
    ): Promise<DeploymentResult> {
        const updates: string[] = [];
        if (updateTokenBaseVK) updates.push('FungibleToken');
        if (updateNoriTokenBridgeVK) updates.push('NoriTokenBridge');
        logger.log(`Updating verification keys for: ${updates.join(', ')}`);

        const senderPrivateKey = PrivateKey.fromBase58(senderPrivateKeyBase58);
        const senderPublicKey = senderPrivateKey.toPublicKey();

        const noriTokenBridgeAddress = PublicKey.fromBase58(
            noriTokenBridgeAddressBase58
        );
        const tokenBaseAddress = PublicKey.fromBase58(tokenBaseAddressBase58);

        const noriTokenBridgeVk = {
            data: noriTokenBridgeVerificationKeySafe.data,
            hash: new Field(BigInt(noriTokenBridgeVerificationKeySafe.hashStr)),
        };
        const fungibleTokenVk = {
            data: fungibleTokenVerificationKeySafe.data,
            hash: new Field(BigInt(fungibleTokenVerificationKeySafe.hashStr)),
        };

        const noriTokenBridge = new NoriTokenBridge(noriTokenBridgeAddress);
        const tokenBase = new FungibleToken(tokenBaseAddress);

        const updateTx = await Mina.transaction(
            { sender: senderPublicKey, fee: txFee },
            async () => {
                if (updateNoriTokenBridgeVK) {
                    logger.log(
                        `Updating NoriTokenBridge VK hash: '${noriTokenBridgeVk.hash}'`
                    );
                    await noriTokenBridge.updateVerificationKey(
                        noriTokenBridgeVk
                    );
                }

                if (updateTokenBaseVK) {
                    logger.log(
                        `Updating FungibleToken VK hash: '${fungibleTokenVk.hash}'`
                    );
                    await tokenBase.updateVerificationKey(fungibleTokenVk);
                }
            }
        );

        logger.log('Update transaction created. Proving...');
        await updateTx.prove();

        logger.log('Transaction proved. Signing and sending...');
        const tx = await updateTx.sign([senderPrivateKey]).send();
        const result = await tx.wait();

        logger.log('Verification keys updated successfully.');

        const tokenBaseTokenId = tokenBase.deriveTokenId().toString();
        const noriTokenBridgeTokenId = noriTokenBridge
            .deriveTokenId()
            .toString();


        return {
            noriTokenBridgeAddress: noriTokenBridge.address.toBase58(),
            tokenBaseAddress: tokenBase.address.toBase58(),
            tokenBaseTokenId,
            noriTokenBridgeTokenId,
            txHash: result.hash,
        };
    }

    // =======================================================================
    // Admin ops
    // =======================================================================

    // Shared boilerplate for admin setters: decode sender, fetch accounts,
    // build + prove + sign + send. The caller only supplies the tx body.
    private async runBridgeTx(
        senderPrivateKeyBase58: string,
        noriTokenBridgeAddressBase58: string,
        txFee: number,
        body: (bridge: NoriTokenBridge) => Promise<void>
    ): Promise<string> {
        const senderPrivateKey = PrivateKey.fromBase58(senderPrivateKeyBase58);
        const senderPublicKey = senderPrivateKey.toPublicKey();
        const noriTokenBridgeAddress = PublicKey.fromBase58(
            noriTokenBridgeAddressBase58
        );
        const bridge = new NoriTokenBridge(noriTokenBridgeAddress);

        await this.fetchAccounts([senderPublicKey, noriTokenBridgeAddress]);

        const tx = await Mina.transaction(
            { sender: senderPublicKey, fee: txFee },
            async () => body(bridge)
        );
        await tx.prove();
        const sent = await tx.sign([senderPrivateKey]).send();
        const result = await sent.wait();
        return result.hash;
    }

    updateIntegrityParams(
        senderPrivateKeyBase58: string,
        noriTokenBridgeAddressBase58: string,
        pi0: string,
        po2: string,
        txFee: number
    ): Promise<string> {
        return this.runBridgeTx(
            senderPrivateKeyBase58,
            noriTokenBridgeAddressBase58,
            txFee,
            async (bridge) => {
                await bridge.updateNoriHeliosProgramPi0(FrC.from(pi0));
                await bridge.updateProofConversionPO2(Field.from(po2));
            }
        );
    }

    updateNoriHeliosProgramPi0(
        senderPrivateKeyBase58: string,
        noriTokenBridgeAddressBase58: string,
        pi0: string,
        txFee: number
    ): Promise<string> {
        return this.runBridgeTx(
            senderPrivateKeyBase58,
            noriTokenBridgeAddressBase58,
            txFee,
            async (bridge) => {
                await bridge.updateNoriHeliosProgramPi0(FrC.from(pi0));
            }
        );
    }

    updateProofConversionPO2(
        senderPrivateKeyBase58: string,
        noriTokenBridgeAddressBase58: string,
        po2: string,
        txFee: number
    ): Promise<string> {
        return this.runBridgeTx(
            senderPrivateKeyBase58,
            noriTokenBridgeAddressBase58,
            txFee,
            async (bridge) => {
                await bridge.updateProofConversionPO2(Field.from(po2));
            }
        );
    }

    // -----------------------------------------------------------------------
    // adminSetDepositRoot — TEST-ONLY worker shim. Disabled alongside the
    // contract method of the same name in
    // `contracts/mina/src/NoriTokenBridge.ts`. Re-enable in lockstep with
    // the contract method and the corresponding `.skip`-ed integration tests
    // when running the bridge locally for testing — bypasses the SP1 proof
    // path so tests can seed deposit roots directly. MUST stay commented out
    // for production builds.
    //
    // async adminSetDepositRoot(
    //     senderPrivateKeyBase58: string,
    //     noriTokenBridgeAddressBase58: string,
    //     depositRootStr: string,
    //     txFee: number
    // ): Promise<string> {
    //     const senderPrivateKey = PrivateKey.fromBase58(senderPrivateKeyBase58);
    //     const senderPublicKey = senderPrivateKey.toPublicKey();
    //     const noriTokenBridgeAddress = PublicKey.fromBase58(
    //         noriTokenBridgeAddressBase58
    //     );
    //     const bridge = new NoriTokenBridge(noriTokenBridgeAddress);
    //
    //     const depositRoot = new Field(BigInt(depositRootStr));
    //
    //     await this.fetchAccounts([senderPublicKey, noriTokenBridgeAddress]);
    //
    //     const tx = await Mina.transaction(
    //         { sender: senderPublicKey, fee: txFee },
    //         async () => {
    //             await bridge.adminSetDepositRoot(depositRoot);
    //         }
    //     );
    //     await tx.prove();
    //     const sent = await tx.sign([senderPrivateKey]).send();
    //     const result = await sent.wait();
    //     return result.hash;
    // }

    // =======================================================================
    // Bridge ops
    // =======================================================================

    async update(
        senderPrivateKeyBase58: string,
        noriTokenBridgeAddressBase58: string,
        sp1PlonkProof: SP1ProofWithPublicValuesPlonkNoTee,
        proofData: ProofDataOutput,
        txFee: number
    ): Promise<string> {
        const senderPrivateKey = PrivateKey.fromBase58(senderPrivateKeyBase58);
        const senderPublicKey = senderPrivateKey.toPublicKey();
        const noriTokenBridgeAddress = PublicKey.fromBase58(
            noriTokenBridgeAddressBase58
        );

        const decoded = decodeConsensusMptProof(sp1PlonkProof);
        const ethInput = new EthInput(decoded);
        const rawProof = await NodeProofLeft.fromJSON(proofData);

        logger.log(
            `Submitting update from sender: ${senderPublicKey.toBase58()}`
        );

        await this.fetchAccounts([senderPublicKey, noriTokenBridgeAddress]);

        const bridge = new NoriTokenBridge(noriTokenBridgeAddress);

        const tx = await Mina.transaction(
            { sender: senderPublicKey, fee: txFee },
            async () => {
                await bridge.update(ethInput, rawProof);
            }
        );
        await tx.prove();
        const sent = await tx.sign([senderPrivateKey]).send();
        const result = await sent.wait();
        logger.log('Update completed successfully.');
        return result.hash;
    }

    // =======================================================================
    // User ops
    // =======================================================================

    // senderPrivateKey pays fee + funds new account. If senderPrivateKey differs
    // from userPrivateKey, userPrivateKey is added as an extra signer (required
    // to authorise creation of the user's token-id account).
    async setUpStorage(
        senderPrivateKeyBase58: string,
        userPrivateKeyBase58: string,
        noriTokenBridgeAddressBase58: string,
        storageInterfaceVerificationKeySafe: SafeVK,
        txFee: number
    ): Promise<string> {
        const senderPrivateKey = PrivateKey.fromBase58(senderPrivateKeyBase58);
        const userPrivateKey = PrivateKey.fromBase58(userPrivateKeyBase58);
        const senderPublicKey = senderPrivateKey.toPublicKey();
        const userPublicKey = userPrivateKey.toPublicKey();
        const noriTokenBridgeAddress = PublicKey.fromBase58(
            noriTokenBridgeAddressBase58
        );

        const hash = new Field(
            BigInt(storageInterfaceVerificationKeySafe.hashStr)
        );
        const storageInterfaceVerificationKey = {
            data: storageInterfaceVerificationKeySafe.data,
            hash,
        };

        await this.fetchAccounts([
            senderPublicKey,
            userPublicKey,
            noriTokenBridgeAddress,
        ]);

        const bridge = new NoriTokenBridge(noriTokenBridgeAddress);

        const tx = await Mina.transaction(
            { sender: senderPublicKey, fee: txFee },
            async () => {
                AccountUpdate.fundNewAccount(senderPublicKey, 1);
                await bridge.setUpStorage(
                    userPublicKey,
                    storageInterfaceVerificationKey
                );
            }
        );
        await tx.prove();

        const signers =
            senderPrivateKeyBase58 === userPrivateKeyBase58
                ? [senderPrivateKey]
                : [senderPrivateKey, userPrivateKey];
        const sent = await tx.sign(signers).send();
        const result = await sent.wait();
        return result.hash;
    }

    async mint(
        senderPrivateKeyBase58: string,
        noriTokenBridgeAddressBase58: string,
        merkleTreeContractDepositAttestorInputJson: MerkleTreeContractDepositAttestorInputJson,
        messageSCRAMStr: string,
        signatureSCRAMBase58: string,
        fundNewAccount: boolean,
        txFee: number
    ): Promise<string> {
        const senderPrivateKey = PrivateKey.fromBase58(senderPrivateKeyBase58);
        const senderPublicKey = senderPrivateKey.toPublicKey();
        const noriTokenBridgeAddress = PublicKey.fromBase58(
            noriTokenBridgeAddressBase58
        );

        const merkleInput = buildMerkleTreeContractDepositAttestorInput(
            merkleTreeContractDepositAttestorInputJson
        );

        const msgCS = CircuitString.fromString(messageSCRAMStr);
        const msgSCRAM = msgCS.values.map((char) => char.toField());
        const signatureSCRAM = Signature.fromBase58(signatureSCRAMBase58);
        const witnessSCRAM = new SCRAMWitness({
            message: msgSCRAM,
            signature: signatureSCRAM,
        });

        await this.fetchAccounts([senderPublicKey, noriTokenBridgeAddress]);

        const bridge = new NoriTokenBridge(noriTokenBridgeAddress);

        const tx = await Mina.transaction(
            { sender: senderPublicKey, fee: txFee },
            async () => {
                if (fundNewAccount) {
                    AccountUpdate.fundNewAccount(senderPublicKey, 1);
                }
                await bridge.noriMint(merkleInput, witnessSCRAM);
            }
        );
        await tx.prove();
        const sent = await tx.sign([senderPrivateKey]).send();
        const result = await sent.wait();
        logger.log('Mint completed successfully.');
        return result.hash;
    }

    // =======================================================================
    // Reads
    // =======================================================================

    async getBalanceOf(
        tokenBaseAddressBase58: string,
        userPublicKeyBase58: string
    ): Promise<string> {
        const tokenBaseAddress = PublicKey.fromBase58(tokenBaseAddressBase58);
        const userPublicKey = PublicKey.fromBase58(userPublicKeyBase58);
        const tokenBase = new FungibleToken(tokenBaseAddress);
        await fetchAccount({
            publicKey: userPublicKey,
            tokenId: tokenBase.deriveTokenId(),
        });
        const balance = await tokenBase.getBalanceOf(userPublicKey);
        return balance.toBigInt().toString();
    }

    async getMintedSoFar(
        noriTokenBridgeAddressBase58: string,
        userPublicKeyBase58: string
    ): Promise<string> {
        const noriTokenBridgeAddress = PublicKey.fromBase58(
            noriTokenBridgeAddressBase58
        );
        const userPublicKey = PublicKey.fromBase58(userPublicKeyBase58);
        const bridge = new NoriTokenBridge(noriTokenBridgeAddress);
        const storage = new NoriStorageInterface(
            userPublicKey,
            bridge.deriveTokenId()
        );
        await fetchAccount({
            publicKey: userPublicKey,
            tokenId: bridge.deriveTokenId(),
        });
        const minted = await storage.mintedSoFar.fetch();
        if (minted === undefined)
            throw new Error('mintedSoFar was undefined (storage not set up?)');
        return minted.toBigInt().toString();
    }
}
