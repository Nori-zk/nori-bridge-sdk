import { Logger, LogPrinter } from '@nori-zk/proof-conversion';
import {
    buildExampleProofCreateArgument,
    buildExampleProofSeriesCreateArguments,
} from './constructExampleProofs.js';
import { MinaEthProcessorSubmitter } from './proofSubmitter.js';
import { wait } from './txWait.js';
import { PrivateKey } from 'o1js';
import { decodeConsensusMptProof } from '@nori-zk/o1js-zk-programs';

new LogPrinter('[TestEthProcessor]', [
    'log',
    'info',
    'warn',
    'error',
    'debug',
    'fatal',
    'verbose',
]);

// Fix testing network to lightnet
process.env.NETWORK = 'lightnet';

const logger = new Logger('JestEthProcessor');

describe('MinaEthProcessorSubmittor Integration Test', () => {
    test('should run the proof submission process correctly', async () => {
        // Generate a random contract key
        process.env.ZKAPP_PRIVATE_KEY = PrivateKey.toBase58(
            PrivateKey.random()
        );

        // Construct a MinaEthProcessorSubmittor
        const proofSubmitter = new MinaEthProcessorSubmitter();

        // Establish the network
        await proofSubmitter.networkSetUp();

        // Compile contracts.
        await proofSubmitter.compileContracts();

        // Get proof
        const proofArgument = buildExampleProofCreateArgument();

        // Deploy contract
        const decoded = decodeConsensusMptProof(proofArgument.sp1PlonkProof);

        await proofSubmitter.deployContract(decoded.inputStoreHash);

        // Build proof.
        const ethProof = await proofSubmitter.createProof(proofArgument);

        // Submit proof.
        const result = await proofSubmitter.submit(ethProof.proof);

        // Wait for finalization
        await wait(result.txId, process.env.MINA_RPC_NETWORK_URL as string);

        logger.log('Awaited finalization succesfully.');
    });

    test('should perform a series of proof submissions', async () => {
        // Generate a random contract key
        process.env.ZKAPP_PRIVATE_KEY = PrivateKey.toBase58(
            PrivateKey.random()
        );

        // Construct a MinaEthProcessorSubmittor
        const proofSubmitter = new MinaEthProcessorSubmitter();

        // Establish the network
        await proofSubmitter.networkSetUp();

        // Compile contracts.
        await proofSubmitter.compileContracts();

        // Get proofs
        const seriesExamples = buildExampleProofSeriesCreateArguments();

        // Deploy contract
        const decoded = decodeConsensusMptProof(
            seriesExamples[0].sp1PlonkProof
        );
        await proofSubmitter.deployContract(decoded.inputStoreHash);

        // Build and submit proofs
        let i = 1;
        for (const example of seriesExamples) {
            logger.log(
                `Running Example ${i} -------------------------------------------------------`
            );
            // Build proof.
            const ethProof = await proofSubmitter.createProof(example);

            // Submit proof.
            const result = await proofSubmitter.submit(ethProof.proof);
            logger.log(`txHash: ${result.txHash}`);

            // Wait for finalization
            await wait(result.txId, process.env.MINA_RPC_NETWORK_URL as string);
            i++;
        }
    });

    test('should invoke a hash validation issue when we skip transition proofs', async () => {
        // Generate a random contract key
        process.env.ZKAPP_PRIVATE_KEY = PrivateKey.toBase58(
            PrivateKey.random()
        );

        // Construct a MinaEthProcessorSubmittor
        const proofSubmitter = new MinaEthProcessorSubmitter();

        // Establish the network
        await proofSubmitter.networkSetUp();

        // Compile contracts.
        await proofSubmitter.compileContracts();

        // Get proof
        const seriesExamples = buildExampleProofSeriesCreateArguments();

        // Deploy contract
        const decoded = decodeConsensusMptProof(
            seriesExamples[0].sp1PlonkProof
        );
        await proofSubmitter.deployContract(decoded.inputStoreHash);

        // Build and submit proofs
        logger.log(
            `Running Example 1 -------------------------------------------------------`
        );

        // Create proof 0
        const ethProof0 = await proofSubmitter.createProof(seriesExamples[0]);

        // Submit proof 0.
        const result0 = await proofSubmitter.submit(ethProof0.proof);
        logger.log(`txHash: ${result0.txHash}`);

        // Wait for finalization
        await wait(result0.txId, process.env.MINA_RPC_NETWORK_URL as string);

        logger.log(
            `Running Example 3 -------------------------------------------------------`
        );

        logger.verbose(
            `Expecting a failure in the next test as we skip a transition proof the input hash for the 3rd example, wont be the same as the output hash from the 1st example`
        );

        // Create proof 2
        const ethProof2 = await proofSubmitter.createProof(seriesExamples[2]);

        // Submit proof 2.
        await expect(proofSubmitter.submit(ethProof2.proof)).rejects.toThrow();
    });

    // TODO add integration test for redeploy FIXME
});
