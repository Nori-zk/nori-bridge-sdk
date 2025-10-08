import {
    EthProcessor,
    ethProcessorVkHash,
} from '@nori-zk/ethprocessor/browser';
import { NoriStorageInterface } from '../NoriStorageInterface.js';
import { noriStorageInterfaceVkHash } from '../integrity/NoriStorageInterface.VkHash.js';
import { FungibleToken } from '../TokenBase.js';
import { fungibleTokenVkHash } from '../integrity/FungibleToken.VkHash.js';
import { NoriTokenController } from '../NoriTokenController.js';
import { noriTokenControllerVkHash } from '../integrity/NoriTokenController.VkHash.js';
import {
    EthVerifier,
    ethVerifierVkHash,
    ZKCacheWithProgram,
} from '@nori-zk/o1js-zk-utils';
import { cacheBuilder } from '@nori-zk/o1js-zk-utils/node';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..', '..', '..');

const caches: ZKCacheWithProgram[] = [
    {
        name: 'EthVerifier',
        program: EthVerifier,
        integrityHash: ethVerifierVkHash,
    },
    {
        name: 'EthProcessor',
        program: EthProcessor,
        integrityHash: ethProcessorVkHash,
    },
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
        name: 'NoriTokenController',
        program: NoriTokenController,
        integrityHash: noriTokenControllerVkHash,
    },
];

const cacheDir = path.resolve(rootDir, '..', '..', '..', 'cache-server', 'cache');
const layoutsDir = path.resolve(rootDir, 'src', 'cache-layouts');

cacheBuilder(caches, cacheDir, layoutsDir).catch((e) => {
    console.error(`Error building cache: ${e.message}`);
    process.exit(1);
});
