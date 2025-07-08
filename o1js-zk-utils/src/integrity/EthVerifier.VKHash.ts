import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ethVerifierVkHash: string = require('./EthVerifier.VkHash.json');
export { ethVerifierVkHash };
