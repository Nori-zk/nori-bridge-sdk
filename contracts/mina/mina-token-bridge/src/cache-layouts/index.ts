import { type ZKCacheLayout } from '@nori-zk/o1js-zk-utils-new';
import { NoriStorageInterfaceCacheLayout } from './NoriStorageInterface.js';
import { FungibleTokenCacheLayout } from './FungibleToken.js';
import { NoriTokenBridgeCacheLayout } from './NoriTokenBridge.js';
export { NoriStorageInterfaceCacheLayout } from './NoriStorageInterface.js';
export { FungibleTokenCacheLayout } from './FungibleToken.js';
export { NoriTokenBridgeCacheLayout } from './NoriTokenBridge.js';

export const allCacheLayouts: ZKCacheLayout[] = [NoriStorageInterfaceCacheLayout, FungibleTokenCacheLayout, NoriTokenBridgeCacheLayout];
