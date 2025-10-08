import { Cache } from 'o1js';
import { type CacheType } from './types.js';

/**
 * File-system-backed cache configuration.
 *
 * - `type` discriminates the config (should be CacheType.FileSystem).
 * - `dir` is the local directory path used by the o1js Cache.
 */
export interface FileSystemCacheConfig {
    type: CacheType.FileSystem;
    dir: string;
}

/**
 * Returns a `Cache.FileSystem` instance from o1js that stores artifacts in the local file system.
 *
 * This function delegates directly to `Cache.FileSystem(dir)` from o1js.
 *
 * @param config - Configuration object specifying the cache type and directory path.
 * @returns An instance of `Cache.FileSystem` using the specified directory.
 *
 * Example:
 * ```ts
 * const cache = fileSystemCacheFactory({ type: CacheType.FileSystem, dir: './zkAppCache' });
 * ```
 */
export function fileSystemCacheFactory(config: FileSystemCacheConfig) {
    return Cache.FileSystem(config.dir);
}
