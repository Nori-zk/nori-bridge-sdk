import { Logger, LogPrinter } from '@nori-zk/proof-conversion';
import { CreateProofArgument } from '@nori-zk/o1js-zk-utils';
import { vkData } from '../proofs/nodeVk.js';
import { p0 } from '../proofs/p0.js';
import { sp1PlonkProof } from '../proofs/sp1Proof.js';
import { MinaEthProcessorSubmitter } from '../proofSubmitter.js';
import { wait } from '../txWait.js';

const logger = new Logger('ProveAndSubmit');

new LogPrinter('[NoriEthProcessor]', [
    'log',
    'info',
    'warn',
    'error',
    'debug',
    'fatal',
    'verbose',
]);

function buildProofCreateArgument() {
    const example: CreateProofArgument = {
        sp1PlonkProof,
        conversionOutputProof: { vkData, proofData: p0 },
    };
    return example;
}

async function main() {
    logger.info(`ProveAndSubmit has started.`);

    // Construct a MinaEthProcessorSubmittor
    const proofSubmitter = new MinaEthProcessorSubmitter();

    // Establish the network
    await proofSubmitter.networkSetUp();

    // Compile contracts.
    await proofSubmitter.compileContracts();

    // Build proof.
    const ethProof = await proofSubmitter.createProof(
        buildProofCreateArgument()
    );

    logger.info(
        `Proof has been successfully created... Moving on to submitting the proof.`
    );

    // Submit proof.
    const txDetails = await proofSubmitter.submit(ethProof.proof);
    logger.log(`TxHash: ${txDetails.txHash}`);

    // Wait for finalization
    logger.log('Waiting for finalization.');
    await wait(txDetails.txId, process.env.MINA_RPC_NETWORK_URL as string);
    logger.log('Finalized!');
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        logger.fatal(`Error in main function.\n${String(err)}`);
        process.exit(1);
    });
