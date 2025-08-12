import { LocalStorageSim } from './localStorageSim.js';
import { createActor, waitFor } from 'xstate';
import { getDepositMachine } from './deposit.js';
import {
    getBridgeStateTopic$,
    getBridgeTimingsTopic$,
    getEthStateTopic$,
} from '../rx/topics.js';
import { firstValueFrom, map, Observable, shareReplay, take } from 'rxjs';
import { getReconnectingBridgeSocket$ } from '../rx/socket.js';

describe('depositMachine', () => {
    let depositMachine: ReturnType<typeof getDepositMachine>;
    const { bridgeSocket$ } = getReconnectingBridgeSocket$();

    // Seem to need to add share replay to avoid contention.
    const ethStateTopic$ = getEthStateTopic$(bridgeSocket$).pipe(
        shareReplay(1)
    );
    const bridgeStateTopic$ = getBridgeStateTopic$(bridgeSocket$).pipe(
        shareReplay(1)
    );
    const bridgeTimingsTopic$ = getBridgeTimingsTopic$(bridgeSocket$).pipe(
        shareReplay(1)
    );

    // Turn the topics into hot observables... (this is slightly annoying to have to do)
    ethStateTopic$.subscribe();
    bridgeStateTopic$.subscribe();
    bridgeTimingsTopic$.subscribe();

    beforeEach(async () => {
        // Fresh window + localStorage before each test
        (global as any).window = {
            localStorage: new LocalStorageSim(),
        };

        // Import machine which relies on the window.localStorage sim.
        const { getDepositMachine } = await import('./deposit.js');

        // Construct the machine
        depositMachine = getDepositMachine({
            ethStateTopic$: ethStateTopic$,
            bridgeStateTopic$: bridgeStateTopic$,
            bridgeTimingsTopic$: bridgeTimingsTopic$,
        });
    });

    // Utility to get a deposit block number
    async function getNextDepositTarget() {
        const nextFinalizationTarget$ = ethStateTopic$.pipe(take(1));
        return firstValueFrom(
            nextFinalizationTarget$.pipe(
                map(
                    ({ latest_finality_block_number }) =>
                        latest_finality_block_number + 10
                )
            )
        );
    }

    test('should be in noActiveDepositNumber when no keys exist', () => {
        window.localStorage.clear();
        const actor = createActor(depositMachine).start();
        expect(actor.getSnapshot().value).toBe('noActiveDepositNumber');
    });

    test('should transition to hasActiveDepositNumber with only deposit number', async () => {
        const depositBlockNumber = await getNextDepositTarget();
        window.localStorage.clear();
        window.localStorage.setItem(
            'activeDepositNumber',
            depositBlockNumber.toString()
        );

        const actor = createActor(depositMachine);

        actor.start();

        await waitFor(actor, (state) =>
            state.matches('hasActiveDepositNumber')
        );

        expect(actor.getSnapshot().value).toBe('hasActiveDepositNumber');
    });

    test('should prioritize computedEthProof over other states', async () => {
        window.localStorage.clear();
        window.localStorage.setItem('activeDepositNumber', '123');
        window.localStorage.setItem('computedEthProof', 'proof-123');
        window.localStorage.setItem('depositMintTx', 'tx-123');

        const actor = createActor(depositMachine).start();

        await waitFor(actor, (state) => state.matches('hasComputedEthProof'));

        expect(actor.getSnapshot().value).toBe('hasComputedEthProof');
    });

    test('should handle missed opportunity immediately', async () => {
        window.localStorage.clear();

        // Use an old deposit number to trigger missed opportunity naturally
        const latestBlock = await getNextDepositTarget();

        const depositBlockNumber = latestBlock - 10000;

        const actor = createActor(depositMachine).start();

        actor.send({ type: 'SET_DEPOSIT_NUMBER', value: depositBlockNumber });

        await new Promise<void>((resolve) => {
            actor.subscribe({
                complete: () => {
                    resolve();
                },
            });
        });

        expect(actor.getSnapshot().value).toBe('missedOpportunity');
    });
    
    // This test is WIP
    /*test('should complete full workflow without delays', async () => {
        const depositBlockNumber = await getNextDepositTarget();
        const actor = createActor(depositMachine).start();

        actor.subscribe((snapshot)=> console.log(snapshot.context, snapshot.value));
        actor.send({ type: 'SET_DEPOSIT_NUMBER', value: depositBlockNumber });
        await waitFor(actor, (state) =>
            state.matches('hasActiveDepositNumber')
        );
        //await waitFor(actor, (state) => state.matches('checkingCanCompute'));

        // Wait for machine to detect CanCompute naturally and transition
        await waitFor(actor, (state) => state.matches('computingEthProof'));

        // Wait for proof computation and transition
        await waitFor(actor, (state) => state.matches('hasComputedEthProof'));

        // Wait for canMintEvaluation state naturally
        await waitFor(actor, (state) => state.matches('canMintEvaluation'));

        // Wait for machine to transition to buildingMintTx
        await waitFor(actor, (state) => state.matches('buildingMintTx'));

        // Wait for mint tx to be built and move to hasDepositMintTx
        await waitFor(actor, (state) => state.matches('hasDepositMintTx'));

        // Submit mint transaction event and wait for submission
        actor.send({ type: 'SUBMIT_MINT_TX' });
        await waitFor(actor, (state) => state.matches('submittingMintTx'));

        // Wait for submission completion (done.invoke event must be triggered internally)
        await waitFor(actor, (state) => state.matches('completed'));
    });*/
});
