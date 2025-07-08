import { resolve } from 'path';
import { rootDir } from './utils.js';

const basePath = resolve(rootDir, '../../src/proofs');

export const pathToSp1Proof = resolve(basePath, `sp1Proof.json`);
export const pathToO1Proof = resolve(basePath, `p0.json`);
export const pathToO1VK = resolve(basePath, `nodeVk.json`);
