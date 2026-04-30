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
 * `header` - the header/unique id for the file (small text)
 * `data`   - raw bytes of the cached file. Stored as `Uint8Array` so
 *            we can hold prover keys >512 MB (V8's string length cap)
 *            and skip a redundant decode/re-encode roundtrip on read.
 */
export interface CacheEntry {
    name: string;
    header: string;
    data: Uint8Array;
}

/**
 * Map of cache entries keyed by file name / persistentId.
 */
export type CacheMap = Record<string, CacheEntry>;

/**
 * Fetches cache file headers and data from a specified URL base.
 *
 * Concurrency is bounded to avoid overwhelming the static cache
 * server when a circuit's layout has many files. Layouts with 30+
 * files (each requiring 2 fetches: data + header) were producing
 * 60+ simultaneous connections, which uWebSockets.js / undici drop
 * with `TypeError: fetch failed` at random positions in the
 * `Promise.all` index.
 *
 * @param baseUrl - The base URL where the files are served.
 * @param files - Array of file names.
 * @param concurrency - Max simultaneous (file, header) pairs in flight.
 *   Each pair issues 2 HTTP requests, so peak open sockets is
 *   `concurrency * 2`. Default 4 keeps peak ≤ 8 which any sane
 *   static server tolerates.
 * @returns A promise resolving to a dictionary of cached file contents.
 */
export async function fetchFiles(
    baseUrl: string,
    files: string[],
    concurrency = 1
): Promise<CacheMap> {
    const cacheMap: CacheMap = {};
    const queue = [...files];
    async function fetchOne(name: string) {
        try {
            const headerUrl = `${baseUrl}/${name}.header`;
            const dataUrl = `${baseUrl}/${name}`;
            // Header first, sequentially. Then body. Avoids the
            // 2-socket-per-file storm AND surfaces which side fails.
            const headerRes = await fetch(headerUrl);
            if (!headerRes.ok)
                throw new Error(
                    `header fetch ${headerUrl} -> HTTP ${headerRes.status}`
                );
            const header = await headerRes.text();
            const dataRes = await fetch(dataUrl);
            if (!dataRes.ok)
                throw new Error(
                    `data fetch ${dataUrl} -> HTTP ${dataRes.status}`
                );
            const dataBuf = await dataRes.arrayBuffer();
            cacheMap[name] = {
                name,
                header,
                data: new Uint8Array(dataBuf),
            };
        } catch (err) {
            // Re-throw with the file name so the upstream stack
            // trace identifies WHICH cache entry blew up.
            const msg = err instanceof Error ? err.message : String(err);
            throw new Error(
                `fetchFiles failed on '${name}' from ${baseUrl}: ${msg}`,
                { cause: err }
            );
        }
    }
    async function worker() {
        for (;;) {
            const name = queue.shift();
            if (!name) return;
            await fetchOne(name);
        }
    }
    const workers = Array.from({ length: Math.max(1, concurrency) }, () =>
        worker()
    );
    await Promise.all(workers);
    return cacheMap;
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
    read({ persistentId, uniqueId }: CacheHeader) {
        const entry = cacheFiles[persistentId];
        if (!entry) return undefined;
        if (entry.header !== uniqueId) return undefined;
        // The bytes are already in the form o1js expects regardless of
        // dataType: for `'string'` artifacts they're the UTF-8 encoded
        // string, for binary artifacts they're the raw prover-key bytes.
        // Returning the stored Uint8Array directly avoids the 512 MB V8
        // string limit that the previous `TextEncoder.encode(stringForm)`
        // path tripped on large prover keys.
        return entry.data;
    },

    write(header: CacheHeader, value: Uint8Array) {
        void header;
        void value;
        // No-op in this implementation
    },

    canWrite: false,
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
