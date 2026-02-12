import { Logger, LogPrinter } from 'esm-iso-logger';
import { NoriTokenController } from '../NoriTokenController.js';
import { FungibleToken } from '../TokenBase.js';
import { type Analyzable } from '../types.js';

new LogPrinter('TestEthProcessor');
const logger = new Logger('GatesSpec');

describe('Work out number of gates for core ZKs', () => {
    async function analyzeZK(zk: Analyzable) {
        const methods = await zk.analyzeMethods();
        logger.log(
            Object.keys(methods).reduce(
                (acc: Record<string, number>, methodName: string) => {
                    acc[methodName] = methods[methodName].gates.length;
                    return acc;
                },
                {}
            )
        );
    }

    test('NoriTokenController', async () => {
        await analyzeZK(NoriTokenController);
    });

    test('FungibleToken', async () => {
        await analyzeZK(FungibleToken);
    })

});
