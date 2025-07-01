import { ConvertedProofVkData } from '@nori-zk/o1js-zk-programs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const vkData: ConvertedProofVkData = require('./nodeVk.json');
export { vkData };