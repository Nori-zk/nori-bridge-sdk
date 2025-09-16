import { Logger, LogPrinter } from '@nori-zk/proof-conversion';
import {
    buildExampleProofCreateArgument,
    buildExampleProofSeriesCreateArguments,
} from './constructExampleProofs.js';
import { MinaEthProcessorSubmitter } from './proofSubmitter.js';
import { wait } from './txWait.js';
import { PrivateKey } from 'o1js';
import { decodeConsensusMptProof } from '@nori-zk/o1js-zk-utils';
import { getNewMinaLiteNetAccountSK } from './testUtils.js';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { promises as fs } from 'fs';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

new LogPrinter('[TestEthProcessor]', [
    'log',
    'info',
    'warn',
    'error',
    'debug',
    'fatal',
    'verbose',
]);

const logger = new Logger('JestEthProcessor');

async function doTestAndCleanup(test: (cacheDir: string) => Promise<void>) {
    // Ephemeral cache dir
    const cacheDir = resolve(__dirname, crypto.randomUUID());

    await fs.mkdir(cacheDir, { recursive: true });

    try {
        await test(cacheDir);
    } finally {
        // Cleanup
        await fs.rm(cacheDir, { recursive: true, force: true });
    }
}

async function cleanCache(cacheDir: string) {
    await fs.rm(cacheDir, { recursive: true, force: true });
}

/*

    o1js 2.9 does not seem to pass proofSubmitter.spec.ts tests, whereas before (with 2.3) we could only do as many as 3 cycles of prove and submit
    with the proof submitter before the o1js instance was ruined now we cannot do more than one cycle of prove and submit, and this time it seems
    like the cache get ruined as well. So I've implemented cleaning up the cache after every prove / submit cycle. This is less than ideal.

*/

describe('MinaEthProcessorSubmittor Integration Test', () => {
    beforeAll(async () => {
        // Fix testing network to lightnet
        process.env.NETWORK = 'lightnet';
        process.env.MINA_RPC_NETWORK_URL = 'http://localhost:8080/graphql';
        process.env.SENDER_PRIVATE_KEY = await getNewMinaLiteNetAccountSK();
    });

    test('cache_removal_should_run_the_proof_submission_process_correctly', async () => {
        await doTestAndCleanup(async () => {
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
            const decoded = decodeConsensusMptProof(
                proofArgument.sp1PlonkProof
            );

            await proofSubmitter.deployContract(decoded.inputStoreHash);

            // Build proof.
            const ethProof = await proofSubmitter.createProof(proofArgument);

            // Submit proof.
            const result = await proofSubmitter.submit(ethProof.proof);

            // Wait for finalization
            await wait(result.txId, process.env.MINA_RPC_NETWORK_URL!);

            logger.log('Awaited finalization succesfully.');
        });
    }, 1000000000);

    test('cache_removal_should_perform_a_series_of_proof_submissions', async () => {
        await doTestAndCleanup(async (cacheDir) => {
            // Generate a random contract key
            process.env.ZKAPP_PRIVATE_KEY = PrivateKey.toBase58(
                PrivateKey.random()
            );

            // Construct a MinaEthProcessorSubmittor
            const proofSubmitter = new MinaEthProcessorSubmitter(cacheDir);

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
                await wait(
                    result.txId,
                    process.env.MINA_RPC_NETWORK_URL as string
                );

                await cleanCache(cacheDir);
                await proofSubmitter.compileContracts();
                i++;
            }
        });
    }, 1000000000);

    test('cache_removal_should_invoke_a_hash_validation_issue_when_we_skip_transition_proofs', async () => {
        await doTestAndCleanup(async (cacheDir) => {
            // Generate a random contract key
            process.env.ZKAPP_PRIVATE_KEY = PrivateKey.toBase58(
                PrivateKey.random()
            );

            // Construct a MinaEthProcessorSubmittor
            const proofSubmitter = new MinaEthProcessorSubmitter(cacheDir);

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
            const ethProof0 = await proofSubmitter.createProof(
                seriesExamples[0]
            );

            // Submit proof 0.
            const result0 = await proofSubmitter.submit(ethProof0.proof);
            logger.log(`txHash: ${result0.txHash}`);

            // Wait for finalization
            await wait(result0.txId, process.env.MINA_RPC_NETWORK_URL!);

            await cleanCache(cacheDir);
            await proofSubmitter.compileContracts();

            logger.log(
                `Running Example 3 -------------------------------------------------------`
            );

            logger.verbose(
                `Expecting a failure in the next test as we skip a transition proof the input hash for the 3rd example, wont be the same as the output hash from the 1st example`
            );

            // Create proof 2
            const ethProof2 = await proofSubmitter.createProof(
                seriesExamples[2]
            );

            // Submit proof 2.
            await expect(
                proofSubmitter.submit(ethProof2.proof)
            ).rejects.toThrow();
        });
    }, 1000000000);

    // TODO add integration test for redeploy FIXME
});
