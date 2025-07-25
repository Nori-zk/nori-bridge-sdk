import {
    concatMap,
    finalize,
    first,
    map,
    Observable,
    switchMap,
    take,
} from 'rxjs';
import { getBridgeSocket$ } from './bridge/socket.js';
import { getEthStateTopic$ } from './eth/topic.js';
import {
    getBridgeStateTopic$,
    getBridgeTimingsTopic$,
} from './bridge/topics.js';
import { getBridgeStateWithTimings$ } from './bridge/state.js';
import { waitForDepositFinalization$ } from './eth/waitForDepositFinalization.js';
import { depositProcessingStatus$ } from './bridge/deposit.js';

function testSub($: Observable<any>) {
    $.subscribe({
        error: console.error,
        next: console.log,
        complete: () => console.log('complete'),
    });
}

const bridgeSocket$ = getBridgeSocket$();
const bridgeStateTopic$ = getBridgeStateTopic$(bridgeSocket$);
const ethStateTopic$ = getEthStateTopic$(bridgeSocket$);
const bridgeTimingsTopic$ = getBridgeTimingsTopic$(bridgeSocket$);
const bridgeStateWithTimings$ = getBridgeStateWithTimings$(
    bridgeStateTopic$,
    bridgeTimingsTopic$
);
const depositFinalization$ = waitForDepositFinalization$(
    4224803,
    ethStateTopic$
);

const nextFinalizationTarget$ = ethStateTopic$.pipe(take(1));

const awaitNextFinalization$ = nextFinalizationTarget$.pipe(
    take(1),
    switchMap(({ latest_finality_block_number }) => {
        return waitForDepositFinalization$(
            latest_finality_block_number + 10,
            ethStateTopic$
        );
    })
);

const awaitProcessing$ = nextFinalizationTarget$.pipe(
    take(1),
    map(
        ({ latest_finality_block_number }) => latest_finality_block_number + 10
    ),
    switchMap((target) =>
        waitForDepositFinalization$(target, ethStateTopic$).pipe(
            // After the previous stream has ended
            concatMap(() =>
                depositProcessingStatus$(
                    target,
                    bridgeStateTopic$,
                    bridgeTimingsTopic$
                )
            )
        )
    )
);

/*;*/
//testSub(depositFinalization$);

/*testSub(bridgeStateTopic$);
testSub(ethStateTopic$);
testSub(bridgeTimingsTopic$);
testSub(bridgeStateWithTimings$)*/

testSub(awaitNextFinalization$);
//testSub(ethStateTopic$);
testSub(awaitProcessing$);
