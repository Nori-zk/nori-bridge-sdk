import type { VkDataOutput } from '@nori-zk/proof-conversion/min';
import vkDataRaw from  './nodeVk.json' with { type: "json" };
const vkData = vkDataRaw as VkDataOutput;
export {vkData};