import { AccountUpdate, Mina, PrivateKey, NetworkId, fetchAccount } from 'o1js';
import { Logger, NodeProofLeft } from '@nori-zk/proof-conversion';
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
} from '@nori-zk/o1js-zk-programs';
import { ethProcessorVkHash } from './integrity/EthProcessor.VKHash.js';

const logger = new Logger('EthProcessorSubmitter');

export class MinaEthProcessorSubmitter {
    zkApp: EthProcessor;
    senderPrivateKey: PrivateKey;
    zkAppPrivateKey: PrivateKey;
    network: NetworkId;
    txFee: number;
    ethProcessorVerificationKey: VerificationKey;
    ethVerifierVerificationKey: VerificationKey;

    constructor(private type: 'plonk' = 'plonk') {
        logger.info(`🛠 MinaEthProcessorSubmitter constructor called!`);
        const errors: string[] = [];

        const senderPrivateKeyBase58 = process.env.SENDER_PRIVATE_KEY as string;
        const network = process.env.NETWORK as string;
        const zkAppPrivateKeyBase58 = process.env.ZKAPP_PRIVATE_KEY as string;

        if (!senderPrivateKeyBase58)
            errors.push('SENDER_PRIVATE_KEY is required');

        if (!network) {
            errors.push('NETWORK is required');
        } else if (!['devnet', 'mainnet', 'lightnet'].includes(network)) {
            errors.push(
                `NETWORK must be one of: devnet, mainnet, lightnet (got "${network}")`
            );
        } else {
            this.network = network as NetworkId;
        }

        if (!zkAppPrivateKeyBase58) {
            errors.push(
                'ZKAPP_PRIVATE_KEY is required when not in lightnet mode'
            );
        }

        if (errors.length > 0) {
            throw `Configuration errors:\n- ${errors.join('\n- ')}`;
        }

        this.senderPrivateKey = PrivateKey.fromBase58(senderPrivateKeyBase58);
        this.zkAppPrivateKey = PrivateKey.fromBase58(zkAppPrivateKeyBase58);
        this.zkApp = new EthProcessor(this.zkAppPrivateKey.toPublicKey());
        this.txFee = Number(process.env.TX_FEE || 0.1) * 1e9;

        logger.log('Loaded constants from: .env');
    }

    async networkSetUp() {
        logger.log('Setting up network.');
        const networkUrl =
            (process.env.MINA_RPC_NETWORK_URL as string) ||
            'https://api.minascan.io/node/devnet/v1/graphql';
        const networkId = this.network === 'mainnet' ? 'mainnet' : 'testnet';
        const Network = Mina.Network({
            networkId,
            mina: networkUrl,
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
        this.ethVerifierVerificationKey = ethVerifierVerificationKey;
        this.ethProcessorVerificationKey = ethProcessorVerificationKey;
    }

    async deployContract(storeHash: Bytes32) {
        logger.log('Creating deploy update transaction.');
        const deployTx = await Mina.transaction(
            { sender: this.senderPrivateKey.toPublicKey(), fee: this.txFee },
            async () => {
                AccountUpdate.fundNewAccount(
                    this.senderPrivateKey.toPublicKey()
                );
                await this.zkApp.deploy({
                    verificationKey: this.ethProcessorVerificationKey,
                });
            }
        );
        logger.log('Deploy transaction created successfully. Proving...');
        await deployTx.prove();
        logger.log(
            'Transaction proved. Signing and sending the transaction...'
        );
        await deployTx
            .sign([this.senderPrivateKey, this.zkAppPrivateKey])
            .send()
            .wait();
        logger.log('EthProcessor deployed successfully.');

        // Update store hash transaction
        logger.log('Creating hash update transaction...');
        const txn = await Mina.transaction(
            { fee: this.txFee, sender: this.senderPrivateKey.toPublicKey() },
            async () => {
                logger.log(`Updating the store hash to '${storeHash.toHex()}'.`);
                await this.zkApp.updateStoreHash(
                    Bytes32FieldPair.fromBytes32(storeHash)
                );
            }
        );

        logger.log('Proving transaction');
        await txn.prove();
        const signedTx = txn.sign([this.senderPrivateKey, this.zkAppPrivateKey]);
        logger.log('Sending transaction...');
        const pendingTx = await signedTx.send();
        logger.log('Waiting for transaction to be included in a block...');
        await pendingTx.wait();
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
            await fetchAccount({ publicKey: this.zkApp.address });
            await fetchAccount({
                publicKey: this.senderPrivateKey.toPublicKey(),
            });
            logger.log('Fetched accounts.');

            logger.log('Creating update transaction.');
            const updateTx = await Mina.transaction(
                {
                    sender: this.senderPrivateKey.toPublicKey(),
                    fee: this.txFee,
                    memo: `State for slot ${ethProof.publicInput.outputSlot.toString()} set`,
                },
                async () => {
                    await this.zkApp.update(ethProof);
                }
            );

            await updateTx.prove();
            logger.log('Transaction proven.');

            const tx = await updateTx.sign([this.senderPrivateKey]).send();
            logger.log(`Transaction sent to '${this.network}'.`);
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
