import { ContractDepositAttestor } from '@nori-zk/o1js-zk-utils';
import { NoriTokenController } from './NoriTokenController.js';
import { EthDepositProgram } from './EthDepositProgram.js';
import { FungibleToken } from './TokenBase.js';

describe('Work out number of gates for core ZKs', () => {
    async function analyzeZK(zk: any) {
        const methods = await zk.analyzeMethods();
        console.log(
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

    test('ContractDeposit', async () => {
        await analyzeZK(ContractDepositAttestor);
    })

    test('EthDepositProgram', async () => {
        await analyzeZK(EthDepositProgram);
    });

    test('FungibleToken', async () => {
        await analyzeZK(FungibleToken);
    })

});
