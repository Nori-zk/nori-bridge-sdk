import { Logger, LogPrinter } from 'esm-iso-logger';
import {
    buildExampleProofCreateArgument,
    buildExampleProofSeriesCreateArguments,
} from './constructExampleProofs.js';
import { NoriTokenBridgeSubmitter } from './proofSubmitter.js';
import { wait } from './txWait.js';
import { PrivateKey } from 'o1js';
import {
    CacheType,
    decodeConsensusMptProof,
    type FileSystemCacheConfig,
} from '@nori-zk/o1js-zk-utils-new';
import os from 'os';
import { resolve } from 'path';
import { mkdirSync, rmSync } from 'fs';
import { getNewMinaLiteNetAccountSK } from './testUtils.js';

new LogPrinter('TestNoriTokenBridge');

process.env.MINA_NETWORK = process.env.MINA_NETWORK || 'lightnet';
process.env.MINA_RPC_NETWORK_URL =
    process.env.MINA_RPC_NETWORK_URL || 'http://localhost:8080/graphql';

const logger = new Logger('JestNoriTokenBridge');

describe('NoriTokenBridgeSubmitter Integration Test', () => {
    function getRandomCacheDir(prefix = 'mina-eth-processor-cache') {
        const randomSuffix = `${Date.now()}-${Math.floor(
            Math.random() * 1_000_000
        )}`;
        const cacheDir = resolve(os.tmpdir(), `${prefix}-${randomSuffix}`);
        mkdirSync(cacheDir, { recursive: true });
        const cacheConfig: FileSystemCacheConfig = {
            type: CacheType.FileSystem,
            dir: cacheDir,
        };
        return cacheConfig;
    }
    void getRandomCacheDir;

    function removeCacheDir(cacheConfig: FileSystemCacheConfig) {
        rmSync(cacheConfig.dir, { recursive: true, force: true });
    }
    void removeCacheDir;

    // Read only cache idea did not work indicating that the cache written to disk
    // is simply not reconstructing the same in memory state as when created from an empty cache.

    /*const cacheDir = resolve(os.tmpdir(), 'mina-eth-processor-cache');
    const readOnlyCacheConfig: FileSystemCacheConfig = {
        type: CacheType.ReadOnlyFileSystem,
        dir: cacheDir,
    };

    beforeAll(async () => {
        logger.info(`Creating fresh cache directory: '${cacheDir}'`);
        rmSync(cacheDir, { recursive: true, force: true });
        mkdirSync(cacheDir, { recursive: true });
        const cacheConfig: FileSystemCacheConfig = {
            type: CacheType.FileSystem,
            dir: cacheDir,
        };
        const proofSubmitter = new NoriTokenBridgeSubmitter(cacheConfig);
        logger.info('Compiling cache.');
        await proofSubmitter.compileContracts();
        logger.info('Compiled cache.');
    });

    afterAll(() => {
        rmSync(cacheDir, { recursive: true, force: true });
    });*/

    test('should run the proof submission process correctly', async () => {
        // Generate a random contract key
        process.env.NORI_MINA_TOKEN_BRIDGE_PRIVATE_KEY = PrivateKey.toBase58(
            PrivateKey.random()
        );

        // Generate a random token base key
        process.env.NORI_MINA_TOKEN_BASE_PRIVATE_KEY = PrivateKey.toBase58(
            PrivateKey.random()
        );

        // Generate a random MINA_SENDER_PRIVATE_KEY
        process.env.MINA_SENDER_PRIVATE_KEY = await getNewMinaLiteNetAccountSK();

        //const cacheDir = getRandomCacheDir();
        try {
            // Construct a NoriTokenBridgeSubmitter
            const proofSubmitter = new NoriTokenBridgeSubmitter(
                //cacheDir // readOnlyCacheConfig
            );

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
            const updateArgs = await proofSubmitter.createProof(proofArgument);

            // Submit proof.
            const result = await proofSubmitter.submit(updateArgs);

            // Wait for finalization
            await wait(result.txId, process.env.MINA_RPC_NETWORK_URL as string);

            logger.log('Awaited finalization succesfully.');
        } finally {
            // removeCacheDir(cacheDir);
        }
    }, 10000000);

    test('should perform a series of proof submissions', async () => {
        // Generate a random contract key
        process.env.NORI_MINA_TOKEN_BRIDGE_PRIVATE_KEY = PrivateKey.toBase58(
            PrivateKey.random()
        );

        // Generate a random token base key
        process.env.NORI_MINA_TOKEN_BASE_PRIVATE_KEY = PrivateKey.toBase58(
            PrivateKey.random()
        );

        // Generate a random MINA_SENDER_PRIVATE_KEY
        process.env.MINA_SENDER_PRIVATE_KEY = await getNewMinaLiteNetAccountSK();

        // const cacheDir = getRandomCacheDir();
        try {
            // Construct a NoriTokenBridgeSubmitter
            const proofSubmitter = new NoriTokenBridgeSubmitter(
                // cacheDir // readOnlyCacheConfig
            );

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
                const updateArgs = await proofSubmitter.createProof(example);

                // Submit proof.
                const result = await proofSubmitter.submit(updateArgs);
                logger.log(`txHash: ${result.txHash}`);

                // Wait for finalization
                await wait(
                    result.txId,
                    process.env.MINA_RPC_NETWORK_URL as string
                );
                i++;
            }
        } finally {
            // removeCacheDir(cacheDir);
        }
    }, 10000000);

    test('should invoke a hash validation issue when we skip transition proofs', async () => {
        // Generate a random contract key
        process.env.NORI_MINA_TOKEN_BRIDGE_PRIVATE_KEY = PrivateKey.toBase58(
            PrivateKey.random()
        );

        // Generate a random token base key
        process.env.NORI_MINA_TOKEN_BASE_PRIVATE_KEY = PrivateKey.toBase58(
            PrivateKey.random()
        );

        // Generate a random MINA_SENDER_PRIVATE_KEY
        process.env.MINA_SENDER_PRIVATE_KEY = await getNewMinaLiteNetAccountSK();

        // const cacheDir = getRandomCacheDir();
        try {
            // Construct a NoriTokenBridgeSubmitter
            const proofSubmitter = new NoriTokenBridgeSubmitter(
                // cacheDir // readOnlyCacheConfig
            );

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
            const updateArgs0 = await proofSubmitter.createProof(
                seriesExamples[0]
            );

            // Submit proof 0.
            const result0 = await proofSubmitter.submit(updateArgs0);
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
            const updateArgs2 = await proofSubmitter.createProof(
                seriesExamples[2]
            );

            // Submit proof 2.
            await expect(
                proofSubmitter.submit(updateArgs2)
            ).rejects.toThrow();
        } finally {
            // removeCacheDir(cacheDir);
        }
    }, 10000000);

    // TODO add integration test for redeploy FIXME
});
