import { PlonkProof } from '@nori-zk/o1js-zk-utils';
import sp1PlonkProofRaw from './sp1Proof.json' with { type: 'json' };
const sp1PlonkProof = sp1PlonkProofRaw as PlonkProof;
export { sp1PlonkProof };
