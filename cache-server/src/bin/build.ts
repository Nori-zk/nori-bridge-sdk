import {
    EthProcessor,
    ethProcessorVkHash,
} from '@nori-zk/ethprocessor/browser';
import {
    NoriStorageInterface,
    noriStorageInterfaceVkHash,
    NoriTokenController,
    noriTokenControllerVkHash,
} from '@nori-zk/mina-token-bridge';
import {
    EthVerifier,
    ethVerifierVkHash,
    ZKCacheWithProgram,
} from '@nori-zk/o1js-zk-utils';
import path from 'path';
import { cacheBuilder } from '../builder.js';

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
        name: 'NoriTokenController',
        program: NoriTokenController,
        integrityHash: noriTokenControllerVkHash,
    },
];

const cacheDir = path.resolve(process.cwd(), 'cache');
const layoutsDir = path.resolve(process.cwd(), 'src', 'layouts');

cacheBuilder(caches, cacheDir, layoutsDir).catch((e) => {
    console.error(`Error building cache: ${e.message}`);
    process.exit(1);
});
