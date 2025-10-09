import { type FileSystemCacheConfig } from './fileSystem.js';
import { type NetworkCacheConfig } from './network.js';

export enum CacheType {
    FileSystem = 'FileSystem',
    ReadOnlyFileSystem = 'ReadOnlyFileSystem',
    Network = 'Network',
}

export { NetworkCacheConfig };
export { FileSystemCacheConfig };
export type CacheConfig = NetworkCacheConfig | FileSystemCacheConfig;
