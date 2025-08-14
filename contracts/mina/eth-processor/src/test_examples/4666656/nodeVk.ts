import { ConvertedProofVkData } from '@nori-zk/o1js-zk-utils';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const vkData: ConvertedProofVkData = require('./nodeVk.json');
export { vkData };