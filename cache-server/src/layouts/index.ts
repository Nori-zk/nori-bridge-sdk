import { ZKCacheLayout } from '@nori-zk/o1js-zk-utils';
import { EthVerifierLayout } from './EthVerifier.js';
import { EthProcessorLayout } from './EthProcessor.js';
import { NoriStorageInterfaceLayout } from './NoriStorageInterface.js';
import { NoriTokenControllerLayout } from './NoriTokenController.js';

export const allCacheLayouts: ZKCacheLayout[] = [EthVerifierLayout, EthProcessorLayout, NoriStorageInterfaceLayout, NoriTokenControllerLayout];
