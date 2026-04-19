import { NoriTokenBridge } from '../NoriTokenBridge.js';
import { noriTokenBridgeVkHash } from '../integrity/NoriTokenBridge.VkHash.js';
import { NoriStorageInterface } from '../NoriStorageInterface.js';
import { noriStorageInterfaceVkHash } from '../integrity/NoriStorageInterface.VkHash.js';
import { FungibleToken } from '../TokenBase.js';
import { fungibleTokenVkHash } from '../integrity/FungibleToken.VkHash.js';
import { type ZKCacheWithProgram } from '@nori-zk/o1js-zk-utils-new';
import { cacheBuilder } from '@nori-zk/o1js-zk-utils-new/node';
import path from 'path';
import { fileURLToPath } from 'url';
import { Logger, LogPrinter } from 'esm-iso-logger';

new LogPrinter('NoriTokenBridge');
const logger = new Logger('BuildCacheServerLayouts');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..', '..', '..');

const caches: ZKCacheWithProgram[] = [
    {
        name: 'NoriStorageInterface',
        program: NoriStorageInterface,
        integrityHash: noriStorageInterfaceVkHash,
    },
    {
        name: 'FungibleToken',
        program: FungibleToken,
        integrityHash: fungibleTokenVkHash,
    },
    {
        name: 'NoriTokenBridge',
        program: NoriTokenBridge,
        integrityHash: noriTokenBridgeVkHash,
    },
];

const cacheDir = path.resolve(rootDir, '..', '..', '..', 'cache-server', 'cache');
const layoutsDir = path.resolve(rootDir, 'src', 'cache-layouts');

cacheBuilder(caches, cacheDir, layoutsDir).catch((e) => {
    logger.fatal(`Error building cache: ${e.message}`);
});
