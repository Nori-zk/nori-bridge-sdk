import { type Cache, type CacheHeader } from 'o1js';
import { type CacheType } from './types.js';

/**
 * Network-backed cache configuration.
 *
 * `type` discriminates the config (should be CacheType.Network).
 * `baseUrl` is the root URL of the server hosting the cache files.
 * `path` the location of the case within the server.
 * `files` is the list of cache file names to fetch from the remote.
 */
export interface NetworkCacheConfig {
    type: CacheType.Network;
    baseUrl: string;
    path: string; 
    files: string[];
}

/**
 * Single cache entry returned from the network fetch.
 *
 * `name`   - the file name (used as persistentId)
 * `header` - the header/unique id for the file
 * `data`   - text contents of the cached file
 */
export interface CacheEntry {
    name: string;
    header: string;
    data: string;
}

/**
 * Map of cache entries keyed by file name / persistentId.
 */
export type CacheMap = Record<string, CacheEntry>;

/**
 * Fetches cache file headers and data from a specified URL base.
 *
 * @param baseUrl - The base URL where the files are served.
 * @param files - Array of file names.
 * @returns A promise resolving to a dictionary of cached file contents.
 */
export async function fetchFiles(
    baseUrl: string,
    files: string[]
): Promise<CacheMap> {
    const cacheList = await Promise.all(
        files.map(async (name) => {
            const [headerRes, dataRes] = await Promise.all([
                fetch(`${baseUrl}/${name}.header`),
                fetch(`${baseUrl}/${name}`),
            ]);

            const [header, data] = await Promise.all([
                headerRes.text(),
                dataRes.text(),
            ]);

            return { name, header, data };
        })
    );

    return cacheList.reduce<CacheMap>((acc, entry) => {
        acc[entry.name] = entry;
        return acc;
    }, {});
}

/**
 * Custom cache interface used for reading and writing compiled zkApp artifacts.
 *
 * This returns an object that implements the `o1js` `Cache` interface:
 *  - `read(header: CacheHeader): Uint8Array | undefined`
 *  - `write(header: CacheHeader, value: Uint8Array): boolean`
 *  - `canWrite: boolean`
 *
 * The backing store is the provided `cacheFiles` (in-memory map).
 *
 * Behaviour:
 *  - `read` looks up the `persistentId` in `cacheFiles`; if found and the stored
 *    `header` matches the provided `uniqueId`, it returns the encoded `data`.
 *  - `write` is currently a no-op.
 *
 * @param cacheFiles - Object containing cached file data keyed by file name.
 * @returns a Cache-compliant object.
 */
export const MinaFileSystem = (cacheFiles: CacheMap): Cache => ({
    read({ persistentId, uniqueId, dataType }: CacheHeader) {
        const entry = cacheFiles[persistentId];
        if (!entry) return undefined;

        if (entry.header !== uniqueId) return undefined;

        if (dataType === 'string') {
            return new TextEncoder().encode(entry.data);
        }

        return undefined;
    },

    write(header: CacheHeader, value: Uint8Array) {
        // No-op in this implementation
    },

    canWrite: true,
});


/**
 * Build a network-backed Cache from a NetworkCacheConfig.
 *
 * Behavior:
 *  - Concatenates `config.baseUrl` and `config.path` to form the full base URL.
 *  - Calls `fetchFiles(fullBase, config.files)` to populate an in-memory CacheMap.
 *  - Returns a MinaFileSystem backed by the fetched map.
 *
 * Failure semantics:
 *  - Any fetch/network error will reject the Promise; no partial success or retries.
 *
 * @param config - NetworkCacheConfig containing the base URL, path, and file list.
 * @returns A Promise that resolves to a `Cache` instance.
 *
 * Example:
 * ```ts
 * const cache = await networkCacheFactory({
 *   type: CacheType.Network,
 *   baseUrl: 'https://cdn.example.com',
 *   path: 'zkAppCache',
 *   files: ['a', 'b'],
 * });
 * // The code will fetch:
 * // https://cdn.example.com/zkAppCache/a.header and /a, then /b.header and /b
 * ```
 */
export async function networkCacheFactory(config: NetworkCacheConfig) {
    const path = `${config.baseUrl}/${config.path}`;
    return MinaFileSystem(await fetchFiles(path, config.files));
}
