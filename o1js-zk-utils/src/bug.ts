import { Cache } from 'o1js';
import {
    EthVerifier,
    CreateProofArgument,
    decodeConsensusMptProof,
    EthInput,
    NodeProofLeft,
} from './index.js';
import seriesExample1 from './8695456/index.js';
import seriesExample2 from './8695488/index.js';

async function main() {
    console.log('Compiling EthVerifier...');
    await EthVerifier.compile({
        cache: { ...Cache.FileSystem('./cache', true), canWrite: true },
    });

    async function createProof(
        proofArguments: CreateProofArgument
    ): Promise<ReturnType<typeof EthVerifier.compute>> {
        try {
            console.log('Creating proof.');

            const { sp1PlonkProof, conversionOutputProof } = proofArguments;

            const rawProof = await NodeProofLeft.fromJSON(
                conversionOutputProof.proofData
            );

            const ethSP1Proof = sp1PlonkProof;

            console.log(
                'Decoding converted proof and creating verification inputs.'
            );

            // Decode proof values and create input for verification.
            const input = new EthInput(decodeConsensusMptProof(ethSP1Proof));

            // Compute and verify proof.
            console.log('Computing proof.');
            return EthVerifier.compute(input, rawProof);
        } catch (err) {
            console.error(`Error computing proof: ${String(err)}`);
            throw err;
        }
    }

    console.log('proof 1');
    const ethProof1 = await createProof(seriesExample1);
    console.log('proof 1 done');

    console.log('proof 2');
    const ethProof2 = await createProof(seriesExample2);
    console.log('proof 2 done');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
