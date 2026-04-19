import NoriStorageInterfaceJson from './NoriStorageInterface.json' with { type: "json" };
import { type ZKCacheLayout } from '@nori-zk/o1js-zk-utils';

export const NoriStorageInterfaceCacheLayout: ZKCacheLayout = NoriStorageInterfaceJson;
