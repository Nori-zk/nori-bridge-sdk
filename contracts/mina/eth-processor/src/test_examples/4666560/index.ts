import { CreateProofArgument } from '../../../../../../o1js-zk-utils/build/index.js';
import { vkData } from './nodeVk.js';
import { p0 } from './p0.js';
import { sp1PlonkProof } from './sp1Proof.js';
const proofArgument: CreateProofArgument = {
    sp1PlonkProof,
    conversionOutputProof: { vkData, proofData: p0 },
};
export default proofArgument;