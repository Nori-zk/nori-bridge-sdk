import { firstValueFrom, map, switchMap, take } from 'rxjs';
import { getDepositProcessingStatus$ } from './rx/deposit.js';
import { getReconnectingBridgeSocket$ } from './rx/socket.js';
import { getBridgeStateWithTimings$ } from './rx/state.js';
import {
    getBridgeStateTopic$,
    getBridgeTimingsTopic$,
    getEthStateTopic$,
} from './rx/topics.js';
import { createActor, fromObservable } from 'xstate';
import { DeferredPromise } from './worker/index.js';

describe('XState integration example', () => {
    test('xstate_should_integrate', async () => {
        const { bridgeSocket$, bridgeSocketConnectionState$ } =
            getReconnectingBridgeSocket$();

        const bridgeStateTopic$ = getBridgeStateTopic$(bridgeSocket$);
        const bridgeTimingsTopic$ = getBridgeTimingsTopic$(bridgeSocket$);
        const ethStateTopic$ = getEthStateTopic$(bridgeSocket$);

        const bridgeStateWithTimings$ = getBridgeStateWithTimings$(
            bridgeStateTopic$,
            bridgeTimingsTopic$
        );

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

        console.log('targetDepositNumber', targetDepositNumber);

        const depositStateObservable = fromObservable<
            unknown,
            { deposit_block_number: number }
        >(({ input: { deposit_block_number } }) =>
            getDepositProcessingStatus$(
                deposit_block_number,
                ethStateTopic$,
                bridgeStateTopic$,
                bridgeTimingsTopic$
            ).pipe(
                map((state) => {
                    return { ...state, type: state.stageName };
                })
            )
        );

        const depositActor = createActor(depositStateObservable, {
            input: { deposit_block_number: targetDepositNumber },
        });

        // This is here just to prevent early test exit.
        const actorCompletion = new DeferredPromise();

        depositActor.subscribe(
            (snapshot) =>
                console.log(snapshot.status, snapshot.context, snapshot.output),
            (error) => {
                actorCompletion.reject(error);
            },
            () => actorCompletion.resolve()
        );
        depositActor.start();

        // Block 
        await actorCompletion.promise;
    }, 1000000000);
});
