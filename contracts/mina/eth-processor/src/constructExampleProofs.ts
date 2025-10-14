import { CreateProofArgument } from '@nori-zk/o1js-zk-utils';
import { vkData } from './proofs/nodeVk.js';
import { p0 } from './proofs/p0.js';
import { sp1PlonkProof } from './proofs/sp1Proof.js';
import seriesExample1 from './test_examples/8727072/index.js';
import seriesExample2 from './test_examples/8727104/index.js';
import seriesExample3 from './test_examples/8727136/index.js';
import seriesExample4 from './test_examples/8727168/index.js';

export function buildExampleProofCreateArgument() {
    const example: CreateProofArgument = {
        sp1PlonkProof,
        conversionOutputProof: { vkData, proofData: p0 },
    };
    return example;
}

export function buildExampleProofSeriesCreateArguments(): Array<CreateProofArgument> {
    return [seriesExample1, seriesExample2, seriesExample3, seriesExample4];
}
