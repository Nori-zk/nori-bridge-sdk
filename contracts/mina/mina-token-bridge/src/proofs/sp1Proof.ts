import type { SP1ProofWithPublicValuesPlonkNoTee } from '@nori-zk/proof-conversion/min';
import sp1PlonkProofRaw from './sp1Proof.json' with { type: "json" };
const sp1PlonkProof = sp1PlonkProofRaw as SP1ProofWithPublicValuesPlonkNoTee;
export { sp1PlonkProof };
