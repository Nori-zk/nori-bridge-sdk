import { PlonkProof } from '@nori-zk/o1js-zk-programs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sp1PlonkProof: PlonkProof = require('./sp1Proof.json');
export { sp1PlonkProof };
