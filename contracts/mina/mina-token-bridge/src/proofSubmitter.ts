import 'dotenv/config';
import {
    AccountUpdate,
    Bool,
    type Field,
    Mina,
    PrivateKey,
    PublicKey,
    type NetworkId,
    UInt8,
    fetchAccount,
} from 'o1js';
import { Logger } from 'esm-iso-logger';
import { NoriTokenBridge } from './NoriTokenBridge.js';
import { NoriStorageInterface } from './NoriStorageInterface.js';
import { FungibleToken } from './TokenBase.js';
import { getOldestActionForEviction } from './NoriTokenBridge.utils.js';
import {
    EthInput,
    decodeConsensusMptProof,
    type CreateProofArgument,
    type VerificationKey,
    type Bytes32,
    Bytes32FieldPair,
    NodeProofLeft,
    type FileSystemCacheConfig,
    compileAndOptionallyVerifyContracts,
} from '@nori-zk/o1js-zk-utils-new';
import { cacheFactory } from '@nori-zk/o1js-zk-utils-new/node';
import type { NodeProofLeft as NodeProofLeftRaw, FrC } from '@nori-zk/proof-conversion/min';
import { noriTokenBridgeVkHash } from './integrity/NoriTokenBridge.VkHash.js';
import { noriStorageInterfaceVkHash } from './integrity/NoriStorageInterface.VkHash.js';
import { fungibleTokenVkHash } from './integrity/FungibleToken.VkHash.js';

const logger = new Logger('NoriTokenBridgeSubmitter');

export type NoriTokenBridgeUpdateArgs = {
    ethInput: EthInput;
    rawProof: NodeProofLeftRaw;
};

export class NoriTokenBridgeSubmitter {
    readonly #zkApp: NoriTokenBridge;
    readonly #senderPrivateKey: PrivateKey;
    readonly #possibleTokenBridgePrivateKey: PrivateKey | undefined;
    readonly #network: NetworkId | 'lightnet';
    readonly #txFee: number;
    readonly noriTokenBridgeVerificationKey: VerificationKey;
    readonly noriStorageInterfaceVerificationKey: VerificationKey;
    readonly #testMode: boolean;
    protected readonly minaRPCNetworkUrl: string;
    protected readonly minaArchiveRPCUrl: string;
    get #noriTokenBridgeVerificationKey() {
        return this.noriTokenBridgeVerificationKey;
    }

    constructor(private cache: FileSystemCacheConfig = undefined) {
        void this.#testMode;
        logger.info(`NoriTokenBridgeSubmitter constructor called.`);
        const errors: string[] = [];

        const possibleSenderPrivateKeyBase58 = process.env.MINA_SENDER_PRIVATE_KEY as string;
        const possibleNetwork = process.env.MINA_NETWORK as string;
        const possibleNetworkUrl = process.env.MINA_RPC_NETWORK_URL as string;
        const possibleArchiveUrl = process.env.MINA_ARCHIVE_RPC_URL as string;

        if (!possibleSenderPrivateKeyBase58)
            errors.push('MINA_SENDER_PRIVATE_KEY is required');

        if (!possibleNetwork) {
            errors.push('MINA_NETWORK is required');
        } else if (!['devnet', 'mainnet', 'lightnet'].includes(possibleNetwork)) {
            errors.push(
                `MINA_NETWORK must be one of: devnet, mainnet, lightnet (got "${possibleNetwork}")`
            );
        } else {
            this.#network = possibleNetwork as NetworkId;
        }

        if (!possibleNetworkUrl) errors.push('MINA_RPC_NETWORK_URL is required');
        if (!possibleArchiveUrl) errors.push('MINA_ARCHIVE_RPC_URL is required');

        const isLightnet = possibleNetwork === 'lightnet';

        const possibleTokenBridgePrivateKeyBase58 = process.env.NORI_MINA_TOKEN_BRIDGE_PRIVATE_KEY as string;
        const possibleTokenBridgeAddressBase58 = process.env.NORI_MINA_TOKEN_BRIDGE_ADDRESS as string;

        if (isLightnet) {
            if (!possibleTokenBridgePrivateKeyBase58)
                errors.push('NORI_MINA_TOKEN_BRIDGE_PRIVATE_KEY is required in lightnet mode');
        } else {
            if (!possibleTokenBridgeAddressBase58)
                errors.push('NORI_MINA_TOKEN_BRIDGE_ADDRESS is required');
        }

        if (errors.length > 0) {
            throw `Configuration errors:\n- ${errors.join('\n- ')}`;
        }

        this.#senderPrivateKey = PrivateKey.fromBase58(possibleSenderPrivateKeyBase58);
        this.#txFee = Number(process.env.MINA_TX_FEE || 0.1) * 1e9;
        this.#testMode = isLightnet;
        this.minaRPCNetworkUrl = possibleNetworkUrl;
        this.minaArchiveRPCUrl = possibleArchiveUrl;

        if (isLightnet) {
            this.#possibleTokenBridgePrivateKey = PrivateKey.fromBase58(possibleTokenBridgePrivateKeyBase58);
            this.#zkApp = new NoriTokenBridge(this.#possibleTokenBridgePrivateKey.toPublicKey());
        } else {
            this.#possibleTokenBridgePrivateKey = undefined;
            this.#zkApp = new NoriTokenBridge(PublicKey.fromBase58(possibleTokenBridgeAddressBase58));
        }

        logger.log('Loaded constants from: .env');
    }

    async networkSetUp() {
        logger.log(
            `Setting up ${this.#network} network with RPC endpoint: '${this.minaRPCNetworkUrl}' and archive endpoint: '${this.minaArchiveRPCUrl}'.`
        );
        const networkId = this.#network === 'mainnet' ? 'mainnet' : 'testnet';
        const Network = Mina.Network({
            networkId,
            mina: this.minaRPCNetworkUrl,
            archive: this.minaArchiveRPCUrl,
        });
        Mina.setActiveInstance(Network);
        logger.log('Finished Mina network setup.');
    }

    async compileContracts() {
        const fileSystemCache = this.cache
            ? await cacheFactory(this.cache)
            : undefined;

        const {
            NoriStorageInterfaceVerificationKey,
            FungibleTokenVerificationKey,
            NoriTokenBridgeVerificationKey,
        } = await compileAndOptionallyVerifyContracts(
            logger,
            [
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
            ],
            fileSystemCache
        );
        Object.defineProperty(this, 'noriStorageInterfaceVerificationKey', {
            value: NoriStorageInterfaceVerificationKey,
            writable: false,
            configurable: false,
            enumerable: true,
        });
        Object.defineProperty(this, 'noriTokenBridgeVerificationKey', {
            value: NoriTokenBridgeVerificationKey,
            writable: false,
            configurable: false,
            enumerable: true,
        });
        void FungibleTokenVerificationKey;
    }

    async deployContract(storeHash: Bytes32, ethTokenBridgeAddress: Field) {
        if (this.#network !== 'lightnet') {
            throw new Error(
                [
                    `Deploy is only supported in test mode, test mode was set to 'false'. Test mode is only possible when the configured network is 'lightnet' and the configured network is '${this.#network}'.`,
                    `Please see the README.md within the 'contracts/mina/mina-token-bridge' workspace of the 'nori-bridge-sdk' repository and use the deploy script 'npm run deploy <storeHash>' instead of this method.`,
                ].join('\n')
            );
        }
        logger.log('Creating deploy transaction.');

        const senderPublicKey = this.#senderPrivateKey.toPublicKey();
        const initialStoreHash = Bytes32FieldPair.fromBytes32(storeHash);
        const tokenBasePrivateKey = PrivateKey.random();
        const tokenBaseAddress = tokenBasePrivateKey.toPublicKey();
        const tokenBase = new FungibleToken(tokenBaseAddress);

        const deployTx = await Mina.transaction(
            { sender: senderPublicKey, fee: this.#txFee },
            async () => {
                AccountUpdate.fundNewAccount(senderPublicKey, 3);
                logger.log(
                    `Deploying NoriTokenBridge with verification key hash: '${this.#noriTokenBridgeVerificationKey.hash}'`
                );
                await this.#zkApp.deploy({
                    verificationKey: this.#noriTokenBridgeVerificationKey,
                    adminPublicKey: senderPublicKey,
                    tokenBaseAddress,
                    storageVKHash:
                        this.noriStorageInterfaceVerificationKey.hash,
                    newStoreHash: initialStoreHash,
                    ethTokenBridgeAddress,
                });
                await tokenBase.deploy({
                    symbol: 'nETH',
                    src: 'https://github.com/2nori/nori-bridge-sdk',
                    allowUpdates: true,
                });
                await tokenBase.initialize(
                    this.#possibleTokenBridgePrivateKey!.toPublicKey(),
                    UInt8.from(6),
                    Bool(false),
                );
            }
        );
        logger.log('Deploy transaction created successfully. Proving...');
        await deployTx.prove();
        logger.log('Transaction proved. Signing and sending the transaction...');
        await deployTx
            .sign([this.#senderPrivateKey, this.#possibleTokenBridgePrivateKey!, tokenBasePrivateKey])
            .send()
            .wait();
        logger.log('NoriTokenBridge and FungibleToken deployed successfully.');
    }

    // Set the on-chain noriHeliosProgramPi0 state (admin-gated).
    async setNoriHeliosProgramPi0(pi0: FrC) {
        logger.log('Creating setNoriHeliosProgramPi0 transaction.');
        const senderPublicKey = this.#senderPrivateKey.toPublicKey();

        const txn = await Mina.transaction(
            { sender: senderPublicKey, fee: this.#txFee },
            async () => {
                await this.#zkApp.setNoriHeliosProgramPi0(pi0);
            }
        );
        await txn.prove();
        await txn.sign([this.#senderPrivateKey]).send().wait();
        logger.log('noriHeliosProgramPi0 set successfully.');
    }

    // Set the on-chain proofConversionPO2 state (admin-gated).
    async setProofConversionPO2(po2: Field) {
        logger.log('Creating setProofConversionPO2 transaction.');
        const senderPublicKey = this.#senderPrivateKey.toPublicKey();

        const txn = await Mina.transaction(
            { sender: senderPublicKey, fee: this.#txFee },
            async () => {
                await this.#zkApp.setProofConversionPO2(po2);
            }
        );
        await txn.prove();
        await txn.sign([this.#senderPrivateKey]).send().wait();
        logger.log('proofConversionPO2 set successfully.');
    }

    // Set both pi0 and po2 in a single transaction.
    async setIntegrityParams(pi0: FrC, po2: Field) {
        logger.log('Creating setIntegrityParams transaction (pi0 + po2).');
        const senderPublicKey = this.#senderPrivateKey.toPublicKey();

        const txn = await Mina.transaction(
            { sender: senderPublicKey, fee: this.#txFee },
            async () => {
                await this.#zkApp.setNoriHeliosProgramPi0(pi0);
                await this.#zkApp.setProofConversionPO2(po2);
            }
        );
        await txn.prove();
        await txn.sign([this.#senderPrivateKey]).send().wait();
        logger.log('Integrity params (pi0 + po2) set successfully.');
    }

    async createProof(
        proofArguments: CreateProofArgument
    ): Promise<NoriTokenBridgeUpdateArgs> {
        try {
            logger.log('Creating proof.');
            const { sp1PlonkProof, conversionOutputProof } = proofArguments;

            const rawProof = await NodeProofLeft.fromJSON(
                conversionOutputProof.proofData
            );

            logger.log(
                'Decoding converted proof and creating verification inputs.'
            );
            const ethInput = new EthInput(
                decodeConsensusMptProof(sp1PlonkProof)
            );

            logger.log('Proof arguments decoded successfully.');
            return { ethInput, rawProof };
        } catch (err) {
            logger.error(`Error creating proof: ${String(err)}`);
            throw err;
        }
    }

    async submit({ ethInput, rawProof }: NoriTokenBridgeUpdateArgs) {
        logger.log('Submitting a proof.');
        try {
            await fetchAccount({ publicKey: this.#zkApp.address });
            await fetchAccount({
                publicKey: this.#senderPrivateKey.toPublicKey(),
            });
            logger.log('Fetched accounts.');

            const oldestAction = await getOldestActionForEviction(this.#zkApp);
            logger.log('Fetched oldest account action for eviction.');

            logger.log('Creating update transaction.');
            const updateTx = await Mina.transaction(
                {
                    sender: this.#senderPrivateKey.toPublicKey(),
                    fee: this.#txFee,
                    memo: `State for slot ${ethInput.outputSlot.toString()} set`,
                },
                async () => {
                    await this.#zkApp.update(ethInput, rawProof, oldestAction);
                }
            );

            await updateTx.prove();
            logger.log('Transaction proven.');

            const tx = await updateTx.sign([this.#senderPrivateKey]).send();
            logger.log(`Transaction sent to '${this.#network}'.`);
            if (!tx.data) {
                throw new Error('Transaction data is undefined');
            }
            const txId = tx.data.sendZkapp.zkapp.id;
            const txHash = tx.data.sendZkapp.zkapp.hash;
            if (!txId) {
                throw new Error('txId is undefined');
            }
            return {
                txId,
                txHash,
            };
        } catch (err) {
            logger.error(`Error submitting proof: ${String(err)}`);
            throw err;
        }
    }
}
