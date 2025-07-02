import { Logger } from '@nori-zk/proof-conversion';
import path from 'path';
import { fileURLToPath } from 'url';
import { EthProcessor } from './ethProcessor.js';
import { ethProcessorVkHash } from './integrity/EthProcessor.VKHash.js';


// Compile and verify contracts utility

export async function compileAndVerifyContracts(logger: Logger) {
    try {

        logger.log('Compiling EthProcessor contract.');
        const ethProcessorVerificationKey = (await EthProcessor.compile())
            .verificationKey;

        // console.log(await EthProcessor.analyzeMethods()); // Used for debugging to make sure our contract compiles fully

        const calculatedEthProcessorVKHash =
            ethProcessorVerificationKey.hash.toString();
        logger.log(
            `EthProcessor contract vk hash compiled: '${calculatedEthProcessorVKHash}'.`
        );

        // Validation
        logger.log('Verifying computed Vk hashes.');

        let disagree: string[] = [];

        if (calculatedEthProcessorVKHash !== ethProcessorVkHash) {
            disagree.push(
                `Computed ethProcessorVKHash '${calculatedEthProcessorVKHash}' disagrees with the one cached within this repository '${ethProcessorVkHash}'.`
            );
        }

        if (disagree.length) {
            disagree.push(
                `Refusing to start. Try clearing your o1js cache directory, typically found at '~/.cache/o1js'. Or do you need to run 'npm run bake-vk-hashes' in the eth-processor repository and commit the change?`
            );
            const errStr = disagree.join('\n');
            throw new Error(errStr);
        }

        logger.log('Contracts compiled.');
        return { ethProcessorVerificationKey };
    } catch (err) {
        console.log((err as unknown as Error).stack);
        logger.error(`Error compiling contracts:\n${String(err)}`);
        throw err;
    }
}

// Root dir

const __filename = fileURLToPath(import.meta.url);
export const rootDir = path.dirname(__filename);