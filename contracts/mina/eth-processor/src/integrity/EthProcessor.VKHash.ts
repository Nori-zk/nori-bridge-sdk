import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ethProcessorVkHash: string = require('./EthProcessor.VkHash.json');
export { ethProcessorVkHash };
