import { PlonkProof } from '@nori-zk/o1js-zk-utils';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const sp1PlonkProof: PlonkProof = require('./sp1Proof.json');
export { sp1PlonkProof };
