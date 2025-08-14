import proofConversionSP1ToPlonkVkDataRaw from './ProofConversion.sp1ToPlonk.vkData.json' with { type: 'json'};
const proofConversionSP1ToPlonkVkData = proofConversionSP1ToPlonkVkDataRaw as {data: string, hash : string};
export { proofConversionSP1ToPlonkVkData };
