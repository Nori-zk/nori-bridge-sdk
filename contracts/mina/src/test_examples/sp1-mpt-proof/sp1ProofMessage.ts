import type { NoriSP1ProofInput } from '@nori-zk/pts-types';
import sp1ConsensusMPTPlonkProofRaw from './10102688-v6.1.0.json' with { type: 'json' };

const sp1ConsensusMPTPlonkProof = {
    ...sp1ConsensusMPTPlonkProofRaw,
    proof: sp1ConsensusMPTPlonkProofRaw.proof as unknown as NoriSP1ProofInput,
};

export { sp1ConsensusMPTPlonkProof };
