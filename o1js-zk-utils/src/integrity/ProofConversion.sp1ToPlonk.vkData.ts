import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const proofConversionSP1ToPlonkVkData: string = require('./ProofConversion.sp1ToPlonk.vkData.json');
export { proofConversionSP1ToPlonkVkData };
