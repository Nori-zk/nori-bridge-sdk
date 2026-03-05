import { type CreateProofArgument } from '@nori-zk/o1js-zk-utils-new';
import seriesExample1 from './test_examples/9578560/index.js';
import seriesExample2 from './test_examples/9578592/index.js';
import seriesExample3 from './test_examples/9578624/index.js';
import seriesExample4 from './test_examples/9578720/index.js';

export function buildExampleProofCreateArgument(): CreateProofArgument {
    return seriesExample1;
}

export function buildExampleProofSeriesCreateArguments(): Array<CreateProofArgument> {
    return [seriesExample1, seriesExample2, seriesExample3, seriesExample4];
}
