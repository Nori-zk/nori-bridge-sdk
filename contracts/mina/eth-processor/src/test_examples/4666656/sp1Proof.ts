import { PlonkProof } from '../../../../../../o1js-zk-utils/build';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sp1PlonkProof: PlonkProof = require('./sp1Proof.json');
export { sp1PlonkProof };
