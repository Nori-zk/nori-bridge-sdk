import { ZKCacheLayout } from '@nori-zk/o1js-zk-utils';
import { EthVerifierCacheLayout } from './EthVerifier.js';
import { EthProcessorCacheLayout } from './EthProcessor.js';
import { NoriStorageInterfaceCacheLayout } from './NoriStorageInterface.js';
import { FungibleTokenCacheLayout } from './FungibleToken.js';
import { NoriTokenControllerCacheLayout } from './NoriTokenController.js';
export { EthVerifierCacheLayout } from './EthVerifier.js';
export { EthProcessorCacheLayout } from './EthProcessor.js';
export { NoriStorageInterfaceCacheLayout } from './NoriStorageInterface.js';
export { FungibleTokenCacheLayout } from './FungibleToken.js';
export { NoriTokenControllerCacheLayout } from './NoriTokenController.js';

export const allCacheLayouts: ZKCacheLayout[] = [EthVerifierCacheLayout, EthProcessorCacheLayout, NoriStorageInterfaceCacheLayout, FungibleTokenCacheLayout, NoriTokenControllerCacheLayout];
