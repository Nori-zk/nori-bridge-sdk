import 'dotenv/config';
import { AccountUpdate, Mina, PrivateKey, NetworkId, fetchAccount } from 'o1js';
import { Logger } from '@nori-zk/proof-conversion';
import { EthProcessor, EthProofType } from './ethProcessor.js';
import {
    EthVerifier,
    EthInput,
    ethVerifierVkHash,
    CreateProofArgument,
    VerificationKey,
    compileAndVerifyContracts,
    decodeConsensusMptProof,
    Bytes32,
    Bytes32FieldPair,
    NodeProofLeft,
} from '@nori-zk/o1js-zk-utils';
import { ethProcessorVkHash } from './integrity/EthProcessor.VKHash.js';

const logger = new Logger('EthProcessorSubmitter');

export class MinaEthProcessorSubmitter {
    readonly #zkApp: EthProcessor;
    readonly #senderPrivateKey: PrivateKey;
    readonly #zkAppPrivateKey: PrivateKey;
    readonly #network: NetworkId | 'lightnet';
    readonly #txFee: number;
    readonly ethProcessorVerificationKey: VerificationKey;
    readonly ethVerifierVerificationKey: VerificationKey;
    readonly #testMode: boolean;
    protected readonly minaRPCNetworkUrl: string;
    get #ethProcessorVerificationKey() {
        return this.ethProcessorVerificationKey;
    }
    get #ethVerifierVerificationKey() {
        return this.ethVerifierVerificationKey;
    }

    constructor(private type: 'plonk' = 'plonk') {
        logger.info(`🛠 MinaEthProcessorSubmitter constructor called!`);
        const errors: string[] = [];

        const senderPrivateKeyBase58 = process.env.SENDER_PRIVATE_KEY as string;
        const network = process.env.NETWORK as string;
        const zkAppPrivateKeyBase58 = process.env.ZKAPP_PRIVATE_KEY as string;
        const networkUrl = process.env.MINA_RPC_NETWORK_URL as string;

        if (!senderPrivateKeyBase58)
            errors.push('SENDER_PRIVATE_KEY is required');

        if (!network) {
            errors.push('NETWORK is required');
        } else if (!['devnet', 'mainnet', 'lightnet'].includes(network)) {
            errors.push(
                `NETWORK must be one of: devnet, mainnet, lightnet (got "${network}")`
            );
        } else {
            this.#network = network as NetworkId;
        }

        if (!networkUrl) {
            errors.push('MINA_RPC_NETWORK_URL is required');
        }

        if (!zkAppPrivateKeyBase58) {
            errors.push(
                'ZKAPP_PRIVATE_KEY is required when not in lightnet mode'
            );
        }

        if (errors.length > 0) {
            throw `Configuration errors:\n- ${errors.join('\n- ')}`;
        }

        this.#senderPrivateKey = PrivateKey.fromBase58(senderPrivateKeyBase58);
        this.#zkAppPrivateKey = PrivateKey.fromBase58(zkAppPrivateKeyBase58);
        this.#zkApp = new EthProcessor(this.#zkAppPrivateKey.toPublicKey());
        this.#txFee = Number(process.env.TX_FEE || 0.1) * 1e9;
        this.#testMode = process.env.NETWORK === 'lightnet';
        this.minaRPCNetworkUrl = networkUrl;

        logger.log('Loaded constants from: .env');
    }

    async networkSetUp() {
        logger.log(
            `Setting up ${this.#network} network with RPC endpoint: '${
                this.minaRPCNetworkUrl
            }'.`
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
        const { ethVerifierVerificationKey, ethProcessorVerificationKey } =
            await compileAndVerifyContracts(logger, [
                {
                    name: 'ethVerifier',
                    program: EthVerifier,
                    integrityHash: ethVerifierVkHash,
                },
                {
                    name: 'ethProcessor',
                    program: EthProcessor,
                    integrityHash: ethProcessorVkHash,
                },
            ]);
        Object.defineProperty(this, 'ethVerifierVerificationKey', {
            value: ethVerifierVerificationKey,
            writable: false,
            configurable: false,
            enumerable: true,
        });
        Object.defineProperty(this, 'ethProcessorVerificationKey', {
            value: ethProcessorVerificationKey,
            writable: false,
            configurable: false,
            enumerable: true,
        });
    }

    async deployContract(storeHash: Bytes32) {
        if (this.#network !== 'lightnet') {
            throw new Error(
                [
                    //prettier-ignore
                    `Deploy is only supported in test mode, test mode was set to 'false'. Test mode is only possible when the configured network is 'lightnet' and the configured network is '${this.#network}'.`,
                    `Please see the README.md within the 'contracts/mina/eth-processor' workspace of the 'nori-bridge-sdk' repository and use the deploy script 'npm run deploy <storeHash>' instead of this method.`
                ].join('\n')               
            );
        }
        logger.log('Creating deploy update transaction.');

        const senderPublicKey = this.#senderPrivateKey.toPublicKey();
        const deployTx = await Mina.transaction(
            { sender: senderPublicKey, fee: this.#txFee },
            async () => {
                AccountUpdate.fundNewAccount(senderPublicKey);
                logger.log(
                    `Deploying smart contract with verification key hash: '${
                        this.#ethProcessorVerificationKey.hash
                    }'`
                );
                await this.#zkApp.deploy({
                    verificationKey: this.#ethProcessorVerificationKey,
                });
                logger.log(
                    `Initializing with adminPublicKey '${senderPublicKey.toBase58()}' and store hash '${storeHash.toHex()}'.`
                );
                await this.#zkApp.initialize(
                    senderPublicKey,
                    Bytes32FieldPair.fromBytes32(storeHash)
                );
            }
        );
        logger.log('Deploy transaction created successfully. Proving...');
        await deployTx.prove();
        logger.log(
            'Transaction proved. Signing and sending the transaction...'
        );
        await deployTx
            .sign([this.#senderPrivateKey, this.#zkAppPrivateKey])
            .send()
            .wait();
        logger.log('EthProcessor deployed successfully.');
    }

    async createProof(
        proofArguments: CreateProofArgument
    ): Promise<ReturnType<typeof EthVerifier.compute>> {
        try {
            logger.log('Creating proof.');
            const { sp1PlonkProof, conversionOutputProof } = proofArguments;

            const rawProof = await NodeProofLeft.fromJSON(
                conversionOutputProof.proofData
            );

            const ethSP1Proof = sp1PlonkProof;

            logger.log(
                'Decoding converted proof and creating verification inputs.'
            );

            // Decode proof values and create input for verification.
            const input = new EthInput(decodeConsensusMptProof(ethSP1Proof));

            // Compute and verify proof.
            logger.log('Computing proof.');
            return EthVerifier.compute(input, rawProof);
        } catch (err) {
            logger.error(`Error computing proof: ${String(err)}`);
            throw err;
        }
    }

    async submit(ethProof: EthProofType) {
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
                    memo: `State for slot ${ethProof.publicInput.outputSlot.toString()} set`,
                },
                async () => {
                    await this.#zkApp.update(ethProof);
                }
            );

            await updateTx.prove();
            logger.log('Transaction proven.');

            const tx = await updateTx.sign([this.#senderPrivateKey]).send();
            logger.log(`Transaction sent to '${this.#network}'.`);
            const txId = tx.data!.sendZkapp.zkapp.id;
            const txHash = tx.data!.sendZkapp.zkapp.hash;
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
