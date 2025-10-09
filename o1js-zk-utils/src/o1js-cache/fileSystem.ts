import { Cache, CacheHeader } from 'o1js';
import { type CacheType } from './types.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * File-system-based cache configuration.
 *
 * - `type` discriminates the config (should be either `CacheType.FileSystem` or `CacheType.ReadOnlyFileSystem`).
 * - `dir` is the local directory path used by the o1js Cache implementation.
 *
 * This configuration is used by both writable (`FileSystem`) and read-only (`ReadOnlyFileSystem`)
 * cache factories, depending on the specified `type`.
 */
export interface FileSystemCacheConfig {
  type: CacheType.FileSystem | CacheType.ReadOnlyFileSystem;
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

/**
 * File-system-backed cache interface used for reading compiled zkApp artifacts.
 *
 * This returns an object that implements the `o1js` `Cache` interface:
 *  - `read(header: CacheHeader): Uint8Array | undefined`
 *  - `write(header: CacheHeader, value: Uint8Array): void`
 *  - `canWrite: boolean`
 *
 * The backing store is the provided `cacheDirectory` on disk.
 *
 * Behaviour:
 *  - `read` reads `${cacheDirectory}/${persistentId}.header` and compares it to the provided `uniqueId`;
 *    if they match it reads `${cacheDirectory}/${persistentId}` and returns its bytes
 *    (strings are UTF-8 encoded via `TextEncoder`).
 *  - `write` is a no-op.
 *
 * @param cacheDirectory - Directory containing cached file data and header files.
 * @returns a Cache-compliant object.
 */
export const ReadOnlyFileSystem = (cacheDirectory: string, debug = false): Cache => ({
  read({ persistentId, uniqueId, dataType }: CacheHeader): Uint8Array | undefined {
    const currentId = readFileSync(resolve(cacheDirectory, `${persistentId}.header`), 'utf8');
    if (currentId !== uniqueId) return undefined;

    if (dataType === 'string') {
      const string = readFileSync(resolve(cacheDirectory, persistentId), 'utf8');
      return new TextEncoder().encode(string);
    }

    const buffer = readFileSync(resolve(cacheDirectory, persistentId)); // Node Buffer
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  },

  write(_header: CacheHeader, _data: Uint8Array): void {
    if (debug) console.warn('Attempted write on read-only FileSystem:', _header.persistentId);
    // no-op (read-only)
  },

  canWrite: false,
  debug,
}) as Cache;


/**
 * Returns a `ReadOnlyFileSystem` cache instance that retrieves artifacts
 * from a specified local directory without modifying it.
 *
 * This function wraps the `ReadOnlyFileSystem` factory for use in
 * configuration contexts, similar to `fileSystemCacheFactory`.
 *
 * @param config - Configuration object specifying the cache type and directory path.
 * @returns An instance of `ReadOnlyFileSystem` using the specified directory.
 *
 * Example:
 * ```ts
 * const cache = readOnlyFileSystemCacheFactory({ type: CacheType.ReadOnlyFileSystem, dir: './zkAppCache' });
 * ```
 */
export function readOnlyFileSystemCacheFactory(config: FileSystemCacheConfig) {
    return ReadOnlyFileSystem(config.dir);
}