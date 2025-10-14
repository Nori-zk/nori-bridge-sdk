import { ConvertedProofVkData } from '../index.js';
import vkDataRaw from  './nodeVk.json' with { type: "json" };
const vkData = vkDataRaw as ConvertedProofVkData;
export {vkData};