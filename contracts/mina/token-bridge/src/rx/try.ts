import { map, Observable, switchMap, take } from 'rxjs';
import { getBridgeSocket$ } from './bridge/socket.js';
import { getEthStateTopic$ } from './eth/topic.js';
import {
    getBridgeStateTopic$,
    getBridgeTimingsTopic$,
} from './bridge/topics.js';
import { getBridgeStateWithTimings$ } from './bridge/state.js';
import { depositProcessingStatus$ } from './bridge/deposit.js';

// Util for testing Obserables
function testSub($: Observable<any>) {
    $.subscribe({
        error: console.error,
        next: console.log,
        complete: () => console.log('complete'),
    });
}

const bridgeSocket$ = getBridgeSocket$();

const bridgeStateTopic$ = getBridgeStateTopic$(bridgeSocket$);
const bridgeTimingsTopic$ = getBridgeTimingsTopic$(bridgeSocket$);
const ethStateTopic$ = getEthStateTopic$(bridgeSocket$);

const bridgeStateWithTimings$ = getBridgeStateWithTimings$(
    bridgeStateTopic$,
    bridgeTimingsTopic$
);

const nextFinalizationTarget$ = ethStateTopic$.pipe(take(1));

const awaitDepositProcessing$ = nextFinalizationTarget$.pipe(
    take(1),
    map(
        ({ latest_finality_block_number }) => latest_finality_block_number + 10
    ),
    switchMap((target) =>
        depositProcessingStatus$(
            target,
            ethStateTopic$,
            bridgeStateTopic$,
            bridgeTimingsTopic$
        )
    )
);

/*testSub(bridgeStateTopic$);
testSub(ethStateTopic$);
testSub(bridgeTimingsTopic$);
testSub(bridgeStateWithTimings$)*/

testSub(ethStateTopic$);
testSub(bridgeStateTopic$);
testSub(awaitDepositProcessing$);
