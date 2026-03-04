import { type CacheConfig, CacheType } from './types.js';
import { networkCacheFactory } from './network.js';

export async function cacheFactory(cacheConfig: CacheConfig) {
    if (cacheConfig.type === CacheType.FileSystem) {
        throw new Error('FileSystem cache is only available in Node.js');
    } else if (cacheConfig.type === CacheType.ReadOnlyFileSystem) {
        throw new Error(
            'ReadOnlyFileSystem cache is only available in Node.js'
        );
    } else if (cacheConfig.type === CacheType.Network) {
        return networkCacheFactory(cacheConfig);
    }
    throw new Error(
        `Unrecognized cache config type: ${JSON.stringify(cacheConfig)}`
    );
}

export * from './types.js';
