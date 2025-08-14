
import { NodeProofLeft as _NodeProofLeft } from '@nori-zk/proof-conversion/min';
import { DynamicProof } from 'o1js';
import { type Subclass } from 'o1js/dist/node/lib/util/types.js';

export const NodeProofLeft = _NodeProofLeft as unknown as Subclass<typeof DynamicProof>;