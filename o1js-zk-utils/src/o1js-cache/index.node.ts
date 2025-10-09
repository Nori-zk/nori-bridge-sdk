import { CacheConfig, CacheType } from './types.js';
import { fileSystemCacheFactory, readOnlyFileSystemCacheFactory } from './fileSystem.js';
import { networkCacheFactory } from './network.js';

export async function cacheFactory(cacheConfig: CacheConfig) {
    if (cacheConfig.type === CacheType.FileSystem) {
        return fileSystemCacheFactory(cacheConfig);
    } 
    else if (cacheConfig.type === CacheType.ReadOnlyFileSystem) {
        return readOnlyFileSystemCacheFactory(cacheConfig)
    }
    else if (cacheConfig.type === CacheType.Network) {
        return networkCacheFactory(cacheConfig);
    }
    throw new Error(
        `Unrecognized cache config type: ${JSON.stringify(cacheConfig)}`
    );
}

export * from './types.js';
