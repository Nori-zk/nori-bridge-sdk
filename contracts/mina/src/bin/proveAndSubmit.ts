import 'dotenv/config';
import { Logger, LogPrinter } from 'esm-iso-logger';
import { type CreateProofArgument } from '@nori-zk/o1js-zk-utils';
import { vkData } from '../proofs/nodeVk.js';
import { p0 } from '../proofs/p0.js';
import { sp1PlonkProof } from '../proofs/sp1Proof.js';
import { NoriTokenBridgeSubmitter } from '../proofSubmitter.js';
import { wait } from '../txWait.js';

const logger = new Logger('ProveAndSubmit');

new LogPrinter('NoriTokenBridge');

function buildProofCreateArgument(): CreateProofArgument {
    return {
        sp1PlonkProof,
        conversionOutputProof: { vkData, proofData: p0 },
    };
}

async function main() {
    logger.info(`ProveAndSubmit has started.`);

    const proofSubmitter = new NoriTokenBridgeSubmitter();

    await proofSubmitter.networkSetUp();

    await proofSubmitter.compileContracts();

    const updateArgs = await proofSubmitter.createProof(
        buildProofCreateArgument()
    );

    logger.info(
        `Proof has been successfully created... Moving on to submitting the proof.`
    );

    const txDetails = await proofSubmitter.submit(updateArgs);
    logger.log(`TxHash: ${txDetails.txHash}`);

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
