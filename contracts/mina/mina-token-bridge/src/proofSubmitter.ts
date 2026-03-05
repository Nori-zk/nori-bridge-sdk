import 'dotenv/config';
import {
    AccountUpdate,
    Bool,
    Mina,
    PrivateKey,
    UInt8,
    type NetworkId,
    fetchAccount,
} from 'o1js';
import { Logger } from 'esm-iso-logger';
import { NoriTokenBridge } from './NoriTokenBridge.js';
import { NoriStorageInterface } from './NoriStorageInterface.js';
import { FungibleToken } from './TokenBase.js';
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
import type { NodeProofLeft as NodeProofLeftRaw } from '@nori-zk/proof-conversion/min';
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
    readonly #fungibleToken: FungibleToken;
    readonly #senderPrivateKey: PrivateKey;
    readonly #tokenBridgePrivateKey: PrivateKey;
    readonly #tokenBasePrivateKey: PrivateKey;
    readonly #network: NetworkId | 'lightnet';
    readonly #txFee: number;
    readonly noriTokenBridgeVerificationKey: VerificationKey;
    readonly noriStorageInterfaceVerificationKey: VerificationKey;
    readonly fungibleTokenVerificationKey: VerificationKey;
    readonly #testMode: boolean;
    protected readonly minaRPCNetworkUrl: string;
    get #noriTokenBridgeVerificationKey() {
        return this.noriTokenBridgeVerificationKey;
    }

    constructor(private cache: FileSystemCacheConfig = undefined) {
        void this.#testMode;
        logger.info(`NoriTokenBridgeSubmitter constructor called.`);
        const errors: string[] = [];

        const senderPrivateKeyBase58 = process.env.MINA_SENDER_PRIVATE_KEY as string;
        const network = process.env.MINA_NETWORK as string;
        const tokenBridgePrivateKeyBase58 = process.env.NORI_MINA_TOKEN_BRIDGE_PRIVATE_KEY as string;
        const tokenBasePrivateKeyBase58 = process.env
            .NORI_MINA_TOKEN_BASE_PRIVATE_KEY as string;
        const networkUrl = process.env.MINA_RPC_NETWORK_URL as string;

        if (!senderPrivateKeyBase58)
            errors.push('MINA_SENDER_PRIVATE_KEY is required');

        if (!network) {
            errors.push('MINA_NETWORK is required');
        } else if (!['devnet', 'mainnet', 'lightnet'].includes(network)) {
            errors.push(
                `MINA_NETWORK must be one of: devnet, mainnet, lightnet (got "${network}")`
            );
        } else {
            this.#network = network as NetworkId;
        }

        if (!networkUrl) errors.push('MINA_RPC_NETWORK_URL is required');

        if (!tokenBridgePrivateKeyBase58)
            errors.push(
                'NORI_MINA_TOKEN_BRIDGE_PRIVATE_KEY is required when not in lightnet mode'
            );

        if (!tokenBasePrivateKeyBase58)
            errors.push(
                'NORI_MINA_TOKEN_BASE_PRIVATE_KEY is required when not in lightnet mode'
            );

        if (errors.length > 0) {
            throw `Configuration errors:\n- ${errors.join('\n- ')}`;
        }

        this.#senderPrivateKey = PrivateKey.fromBase58(senderPrivateKeyBase58);
        this.#tokenBridgePrivateKey = PrivateKey.fromBase58(tokenBridgePrivateKeyBase58);
        this.#tokenBasePrivateKey = PrivateKey.fromBase58(
            tokenBasePrivateKeyBase58
        );
        this.#zkApp = new NoriTokenBridge(this.#tokenBridgePrivateKey.toPublicKey());
        this.#fungibleToken = new FungibleToken(
            this.#tokenBasePrivateKey.toPublicKey()
        );
        this.#txFee = Number(process.env.MINA_TX_FEE || 0.1) * 1e9;
        this.#testMode = process.env.MINA_NETWORK === 'lightnet';
        this.minaRPCNetworkUrl = networkUrl;

        logger.log('Loaded constants from: .env');
    }

    async networkSetUp() {
        logger.log(
            `Setting up ${this.#network} network with RPC endpoint: '${this.minaRPCNetworkUrl}'.`
        );
        const networkId = this.#network === 'mainnet' ? 'mainnet' : 'testnet';
        const Network = Mina.Network({
            networkId,
            mina: this.minaRPCNetworkUrl,
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
        Object.defineProperty(this, 'fungibleTokenVerificationKey', {
            value: FungibleTokenVerificationKey,
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
    }

    async deployContract(storeHash: Bytes32) {
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
                    tokenBaseAddress: this.#fungibleToken.address,
                    storageVKHash:
                        this.noriStorageInterfaceVerificationKey.hash,
                    newStoreHash: initialStoreHash,
                });
                logger.log('Deploying FungibleToken.');
                await this.#fungibleToken.deploy({
                    symbol: 'nETH',
                    src: 'https://github.com/2nori/nori-bridge-sdk',
                    allowUpdates: true,
                });
                await this.#fungibleToken.initialize(
                    this.#zkApp.address,
                    UInt8.from(6),
                    Bool(false)
                );
            }
        );
        logger.log('Deploy transaction created successfully. Proving...');
        await deployTx.prove();
        logger.log('Transaction proved. Signing and sending the transaction...');
        await deployTx
            .sign([
                this.#senderPrivateKey,
                this.#tokenBridgePrivateKey,
                this.#tokenBasePrivateKey,
            ])
            .send()
            .wait();
        logger.log('NoriTokenBridge and FungibleToken deployed successfully.');
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

            logger.log('Creating update transaction.');
            const updateTx = await Mina.transaction(
                {
                    sender: this.#senderPrivateKey.toPublicKey(),
                    fee: this.#txFee,
                    memo: `State for slot ${ethInput.outputSlot.toString()} set`,
                },
                async () => {
                    await this.#zkApp.update(ethInput, rawProof);
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
