import vkDataRaw from './nodeVk.json' with { type: 'json' };
import type { ConvertedProofVkData } from '@nori-zk/o1js-zk-utils';
const vkData = vkDataRaw as ConvertedProofVkData;
export { vkData };