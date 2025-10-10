import { ConvertedProofVkData } from '@nori-zk/o1js-zk-utils';
import vkDataRaw from  './nodeVk.json' with { type: "json" };
const vkData = vkDataRaw as ConvertedProofVkData;
export {vkData};