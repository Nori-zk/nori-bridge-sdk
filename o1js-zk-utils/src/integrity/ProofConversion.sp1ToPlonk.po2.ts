import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const proofConversionSP1ToPlonkPO2: string = require('./ProofConversion.sp1ToPlonk.po2.json');
export { proofConversionSP1ToPlonkPO2 };
