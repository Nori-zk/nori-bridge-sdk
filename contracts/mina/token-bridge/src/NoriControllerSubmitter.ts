import 'dotenv/config';
import {
    AccountUpdate,
    Mina,
    PrivateKey,
    PublicKey,
    NetworkId,
    fetchAccount,
    UInt64,
    UInt8,
    Bool,
    Field,
    VerificationKey,
    Cache,
} from 'o1js';
import { Logger } from '@nori-zk/proof-conversion';
import { FungibleToken } from './TokenBase.js';
import { NoriStorageInterface } from './NoriStorageInterface.js';
import {
    MockNoriTokenController,
    MockConsenusProof,
    MockDepositAttesterProof,
    MockMinaAttestationProof,
    MockMintProofData,
} from './NoriTokenControllerMock.js';
import { ContractDepositAttestor } from '@nori-zk/o1js-zk-utils';
import { EthVerifier } from '@nori-zk/o1js-zk-utils';
import { EthDepositProgram } from './e2ePrerequisites.js';
import { MintProofData, NoriTokenController } from './NoriTokenController.js';
import {
    compileEcdsaEthereum,
    compileEcdsaSigPresentationVerifier,
} from './credentialAttestation.js';

export interface NoriTokenControllerConfig {
    senderPrivateKey: string; //TODO make client side version
    network: NetworkId;
    networkUrl: string;
    txFee?: number;
    // Optional for external users who want to use existing contracts
    noriTokenControllerAddress?: string;
    tokenBaseAddress?: string;
    // Required for deployment
    noriTokenControllerPrivateKey?: string;
    tokenBasePrivateKey?: string;
    adminPublicKey?: string;
    ethProcessorAddress?: string;
    mock?: boolean;
}

export interface DeploymentResult {
    noriTokenControllerAddress: string;
    tokenBaseAddress: string;
    txHash: string;
}

export interface MintResult {
    txHash: string;
    mintedAmount: string;
    userBalance: string;
}

export class NoriTokenControllerSubmitter {
    readonly #senderPrivateKey: PrivateKey;
    readonly #network: NetworkId;
    readonly #txFee: number;
    protected readonly minaRPCNetworkUrl: string;

    // Contract instances
    #noriTokenController: MockNoriTokenController | NoriTokenController;
    #tokenBase: FungibleToken;

    // Optional private keys for deployment
    readonly #noriTokenControllerPrivateKey?: PrivateKey;
    readonly #tokenBasePrivateKey?: PrivateKey;
    readonly #adminPublicKey?: PublicKey;
    readonly #ethProcessorAddress?: PublicKey;

    // Verification keys (set after compilation)
    noriTokenControllerVerificationKey!: VerificationKey;
    tokenBaseVerificationKey!: VerificationKey;
    storageInterfaceVerificationKey!: VerificationKey;

    readonly #mock: boolean;
    readonly #cache = Cache.FileSystem('./cache');

    constructor(config: NoriTokenControllerConfig) {
        console.log(`🛠 NoriTokenControllerSubmitter constructor called!`);

        const errors: string[] = [];

        // Validate required config
        if (!config.senderPrivateKey) {
            errors.push('senderPrivateKey is required');
        }
        if (!config.network) {
            errors.push('network is required');
        }
        if (!config.networkUrl) {
            errors.push('networkUrl is required');
        }

        // For deployment, we need additional keys
        const isDeployment =
            !config.noriTokenControllerAddress || !config.tokenBaseAddress;
        if (isDeployment) {
            if (!config.noriTokenControllerPrivateKey) {
                errors.push(
                    'noriTokenControllerPrivateKey is required for deployment'
                );
            }
            if (!config.tokenBasePrivateKey) {
                errors.push('tokenBasePrivateKey is required for deployment');
            }
            if (!config.adminPublicKey) {
                errors.push('adminPublicKey is required for deployment');
            }
            // if (!config.ethProcessorAddress) { //TODO enable when needed
            //     errors.push('ethProcessorAddress is required for deployment');
            // }
        }

        if (errors.length > 0) {
            throw new Error(`Configuration errors:\n- ${errors.join('\n- ')}`);
        }

        // Set instance variables
        this.#senderPrivateKey = PrivateKey.fromBase58(config.senderPrivateKey);
        this.#network = config.network;
        this.#txFee = (config.txFee || 0.1) * 1e9;
        this.minaRPCNetworkUrl = config.networkUrl;

        // Set deployment keys if provided
        if (config.noriTokenControllerPrivateKey) {
            this.#noriTokenControllerPrivateKey = PrivateKey.fromBase58(
                config.noriTokenControllerPrivateKey
            );
        }
        if (config.tokenBasePrivateKey) {
            this.#tokenBasePrivateKey = PrivateKey.fromBase58(
                config.tokenBasePrivateKey
            );
        }
        if (config.adminPublicKey) {
            this.#adminPublicKey = PublicKey.fromBase58(config.adminPublicKey);
        }
        if (config.ethProcessorAddress) {
            this.#ethProcessorAddress = PublicKey.fromBase58(
                config.ethProcessorAddress
            );
        }

        // Initialize contract instances
        const noriAddress = config.noriTokenControllerAddress
            ? PublicKey.fromBase58(config.noriTokenControllerAddress)
            : this.#noriTokenControllerPrivateKey!.toPublicKey();

        const tokenAddress = config.tokenBaseAddress
            ? PublicKey.fromBase58(config.tokenBaseAddress)
            : this.#tokenBasePrivateKey!.toPublicKey();

        this.#mock = !!config.mock || false;

        this.#noriTokenController = this.#mock
            ? new MockNoriTokenController(noriAddress)
            : new NoriTokenController(noriAddress);

        this.#tokenBase = new FungibleToken(tokenAddress);

        console.log('NoriTokenControllerSubmitter initialized successfully');
    }

    async networkSetUp(): Promise<void> {
        console.log(
            `Setting up ${this.#network} network with RPC endpoint: '${
                this.minaRPCNetworkUrl
            }'.`
        );

        const Network = Mina.Network({
            networkId: this.#network,
            mina: this.minaRPCNetworkUrl,
            ...(this.#network.toString().match('localhost') && {
                lightnetAccountManager: 'http://localhost:8181',
            }),
        });

        Mina.setActiveInstance(Network);
        console.log('Finished Mina network setup.');
    }

    async #compilePrerequisites() {
        if (this.#mock) return;

        // Compile programs / contracts
        console.time('compileEcdsaEthereum');
        await compileEcdsaEthereum(this.#cache);
        console.timeEnd('compileEcdsaEthereum'); // 1:20.330 (m:ss.mmm)

        console.time('compilePresentationVerifier');
        await compileEcdsaSigPresentationVerifier(this.#cache);
        console.timeEnd('compilePresentationVerifier'); // 11.507s

        console.time('ContractDepositAttestor compile');
        const { verificationKey: contractDepositAttestorVerificationKey } =
            await ContractDepositAttestor.compile({
                cache: this.#cache,
                forceRecompile: true,
            });
        console.timeEnd('ContractDepositAttestor compile');
        console.log(
            `ContractDepositAttestor contract compiled vk: '${contractDepositAttestorVerificationKey.hash}'.`
        );

        console.time('EthVerifier compile');
        const { verificationKey: ethVerifierVerificationKey } =
            await EthVerifier.compile({
                cache: this.#cache,
                forceRecompile: true,
            });
        console.timeEnd('EthVerifier compile');
        console.log(
            `EthVerifier compiled vk: '${ethVerifierVerificationKey.hash}'.`
        );

        console.time('EthDepositProgram compile');
        const { verificationKey: EthDepositProgramVerificationKey } =
            await EthDepositProgram.compile({
                cache: this.#cache,
                forceRecompile: true,
            });
        console.timeEnd('EthDepositProgram compile');
        console.log(
            `EthDepositProgram compiled vk: '${EthDepositProgramVerificationKey.hash}'.`
        );
    }

    async compileContracts(): Promise<void> {
        console.log('Compiling prerequisites...');
        await this.#compilePrerequisites();

        console.log('Compiling contracts...');
        // Compile all required contracts
        console.log('Compiling NoriStorageInterface...');
        const storageResult = await NoriStorageInterface.compile({
            cache: this.#cache,
        });

        console.log('Compiling FungibleToken...');
        const tokenBaseResult = await FungibleToken.compile({
            cache: this.#cache,
        });

        console.log('Compiling NoriTokenController...');
        const controllerResult = this.#mock
            ? await MockNoriTokenController.compile({
                  cache: this.#cache,
              })
            : await NoriTokenController.compile({
                  cache: this.#cache,
              });
        //TODO replace with compileAndVerifyContracts

        this.storageInterfaceVerificationKey = storageResult.verificationKey;
        this.tokenBaseVerificationKey = tokenBaseResult.verificationKey;
        this.noriTokenControllerVerificationKey =
            controllerResult.verificationKey;

        console.log('All contracts compiled successfully');
    }

    async deployContracts(
        options: {
            symbol?: string;
            decimals?: number;
            allowUpdates?: boolean;
            startPaused?: boolean;
        } = {}
    ): Promise<DeploymentResult> {
        if (
            !this.#noriTokenControllerPrivateKey ||
            !this.#tokenBasePrivateKey ||
            !this.#adminPublicKey
        ) {
            throw new Error('Deployment keys not provided in constructor');
        }

        console.log('Deploying NoriTokenController and TokenBase contracts...');

        const symbol = options.symbol || 'nETH';
        const decimals = UInt8.from(options.decimals || 18);
        const allowUpdates = options.allowUpdates ?? true;
        const startPaused = Bool(options.startPaused ?? false);

        const senderPublicKey = this.#senderPrivateKey.toPublicKey();

        const deployTx = await Mina.transaction(
            { sender: senderPublicKey, fee: this.#txFee },
            async () => {
                AccountUpdate.fundNewAccount(senderPublicKey, 3);

                // Deploy NoriTokenController
                await this.#noriTokenController.deploy({
                    adminPublicKey: this.#adminPublicKey!,
                    tokenBaseAddress: this.#tokenBase.address,
                    storageVKHash: this.storageInterfaceVerificationKey.hash,
                    ethProcessorAddress:
                        this.#ethProcessorAddress ||
                        PrivateKey.random().toPublicKey(),
                });

                // Deploy TokenBase
                await this.#tokenBase.deploy({
                    symbol,
                    src: 'https://nori',
                    allowUpdates,
                });

                // Initialize TokenBase
                await this.#tokenBase.initialize(
                    this.#noriTokenController.address,
                    decimals,
                    startPaused
                );
            }
        );

        console.log('Deploy transaction created. Proving...');
        await deployTx.prove();

        console.log('Transaction proved. Signing and sending...');
        const tx = await deployTx
            .sign([
                this.#senderPrivateKey,
                this.#noriTokenControllerPrivateKey,
                this.#tokenBasePrivateKey,
            ])
            .send();

        const result = await tx.wait();

        console.log('Contracts deployed successfully');

        return {
            noriTokenControllerAddress:
                this.#noriTokenController.address.toBase58(),
            tokenBaseAddress: this.#tokenBase.address.toBase58(),
            txHash: result.hash,
        };
    }

    async setupStorage(userPublicKey: PublicKey): Promise<{ txHash: string }> {
        console.log(`Setting up storage for user: ${userPublicKey.toBase58()}`);

        await this.fetchAccounts([userPublicKey]);
        await this.fetchAccounts([this.#noriTokenController.address]);
        // await fetchAccount({
        //     publicKey: userPublicKey,
        //     tokenId: this.#noriTokenController.deriveTokenId(),
        // });

        const setupTx = await Mina.transaction(
            { sender: userPublicKey, fee: this.#txFee },
            async () => {
                AccountUpdate.fundNewAccount(userPublicKey, 1);
                await this.#noriTokenController.setUpStorage(
                    userPublicKey,
                    this.storageInterfaceVerificationKey
                );
            }
        );

        await setupTx.prove();
        const tx = await setupTx.sign([this.#senderPrivateKey]).send();
        const result = await tx.wait();

        console.log('Storage setup completed successfully');
        return { txHash: result.hash };
    }

    #isMintProofData(obj: any): obj is MintProofData {
        return 'ethDepositProof' in obj && 'presentationProof' in obj;
    }

    //TODO make one that returns unsigned transaction to be passed to the wallet
    async mint(
        userPublicKey: PublicKey,
        proofData: MockMintProofData | MintProofData,
        userPrivateKey: PrivateKey,
        fundNewAccount = true
    ): Promise<MintResult> {
        console.log(`Minting tokens for user: ${userPublicKey.toBase58()}`);

        await this.fetchAccounts([userPublicKey]);

        const mintTx = await Mina.transaction(
            { sender: userPublicKey, fee: this.#txFee },
            async () => {
                if (fundNewAccount) {
                    AccountUpdate.fundNewAccount(userPublicKey, 1);
                }

                if (this.#mock) {
                    const mockNoriTokenController = this
                        .#noriTokenController as MockNoriTokenController;
                    const mockProofData = proofData as MockMintProofData;
                    await mockNoriTokenController.noriMint(
                        mockProofData.ethConsensusProof,
                        mockProofData.depositAttesterProof,
                        mockProofData.minaAttestationProof
                    );
                } else {
                    const noriTokenController = this
                        .#noriTokenController as NoriTokenController;
                    const realProofData = proofData as MintProofData;
                    await noriTokenController.noriMint(
                        realProofData.ethDepositProof,
                        realProofData.presentationProof
                    );
                }
            }
        );

        await mintTx.prove();
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
        }
    }

    async getUserBalance(userPublicKey: PublicKey): Promise<UInt64> {
        await fetchAccount({
            publicKey: userPublicKey,
            tokenId: this.#tokenBase.deriveTokenId(),
        });
        return this.#tokenBase.getBalanceOf(userPublicKey);
    }

    async getUserStorageInfo(userPublicKey: PublicKey): Promise<{
        userKeyHash: Field;
        mintedSoFar: Field;
    }> {
        const storage = new NoriStorageInterface(
            userPublicKey,
            this.#noriTokenController.deriveTokenId()
        );

        await fetchAccount({
            publicKey: userPublicKey,
            tokenId: this.#noriTokenController.deriveTokenId(),
        });

        const userKeyHash = await storage.userKeyHash.fetch();
        const mintedSoFar = await storage.mintedSoFar.fetch();

        return { userKeyHash, mintedSoFar };
    }

    // Getters for contract addresses
    get noriTokenControllerAddress(): string {
        return this.#noriTokenController.address.toBase58();
    }

    get tokenBaseAddress(): string {
        return this.#tokenBase.address.toBase58();
    }

    get contracts() {
        return {
            noriTokenController: this.#noriTokenController,
            tokenBase: this.#tokenBase,
        };
    }

    private async fetchAccounts(accounts: PublicKey[]): Promise<void> {
        await Promise.all(
            accounts.map((addr) => fetchAccount({ publicKey: addr }))
        );
    }
}
