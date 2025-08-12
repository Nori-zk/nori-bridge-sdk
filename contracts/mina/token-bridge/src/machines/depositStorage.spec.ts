import { LocalStorageSim } from './localStorageSim.js';
import { createActor } from 'xstate';
import type { depositMachine } from './depositStorage.js';
import { getEthStateTopic$ } from '../rx/topics.js';
import { firstValueFrom, map, take } from 'rxjs';

describe('depositMachine', () => {
    let machine: typeof depositMachine;

    beforeEach(async () => {
        // fresh window + localStorage polyfill before each test
        (global as any).window = {
            localStorage: new LocalStorageSim(),
        };

        // import machine after polyfill is ready
        ({ depositMachine: machine } = await import('./depositStorage.js'));
    });

    // Just a test facility to get some block number ahead of finality given the ethStateTopic$
    async function getNextDepositTarget(
        ethStateTopic$: ReturnType<typeof getEthStateTopic$>
    ) {
        const nextFinalizationTarget$ = ethStateTopic$.pipe(take(1));

        // This is just to get a recent block number dynamically from the bridge.
        const targetDepositNumber = await firstValueFrom(
            nextFinalizationTarget$.pipe(
                take(1),
                map(
                    ({ latest_finality_block_number }) =>
                        latest_finality_block_number + 10
                )
            )
        );

        return targetDepositNumber;
    }

    test('goes to NoActiveDepositNumber when no storage keys exist', () => {
        const service = createActor(machine).start();
        expect(service.getSnapshot().value).toBe('noActiveDepositNumber');
    });

    test('goes to hasActiveDepositNumber when only activeDepositNumber exists', () => {
        window.localStorage.setItem('activeDepositNumber', '123');
        const service = createActor(machine).start();
        expect(service.getSnapshot().value).toBe('hasActiveDepositNumber');
    });

    test('goes to hasDepositMintTx when activeDepositNumber and depositMintTx exist', () => {
        window.localStorage.setItem('activeDepositNumber', '123');
        window.localStorage.setItem('depositMintTx', 'mint-tx-hash');
        const service = createActor(machine).start();
        expect(service.getSnapshot().value).toBe('hasDepositMintTx');
    });

    test('goes to hasComputedEthProof when activeDepositNumber and computedEthProof exist but no depositMintTx', () => {
        window.localStorage.setItem('activeDepositNumber', '123');
        window.localStorage.setItem('computedEthProof', 'proof-data');
        const service = createActor(machine).start();
        expect(service.getSnapshot().value).toBe('hasComputedEthProof');
    });

    test('goes to hasComputedEthProof when all three keys exist', () => {
        window.localStorage.setItem('activeDepositNumber', '123');
        window.localStorage.setItem('depositMintTx', 'mint-tx-hash');
        window.localStorage.setItem('computedEthProof', 'proof-data');
        const service = createActor(machine).start();
        expect(service.getSnapshot().value).toBe('hasComputedEthProof');
    });
});
