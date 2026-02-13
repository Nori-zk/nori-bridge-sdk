import { map, type Observable, switchMap, take } from 'rxjs';
import { getReconnectingBridgeSocket$ } from './socket.js';
import {
    getBridgeStateTopic$,
    getBridgeTimingsTopic$,
    getEthStateTopic$,
} from './topics.js';
import { getBridgeStateWithTimings$ } from './state.js';
import { getDepositProcessingStatus$ } from './deposit.js';
import { Logger } from 'esm-iso-logger';

const logger = new Logger('RxTry');

// Util for testing Obserables
function testSub($: Observable<unknown>) {
    $.subscribe({
        error: logger.error,
        next: logger.log,
        complete: () => logger.log('complete'),
    });
}

const { bridgeSocket$, bridgeSocketConnectionState$ } =
    getReconnectingBridgeSocket$();
void bridgeSocketConnectionState$;

const bridgeStateTopic$ = getBridgeStateTopic$(bridgeSocket$);
const bridgeTimingsTopic$ = getBridgeTimingsTopic$(bridgeSocket$);
const ethStateTopic$ = getEthStateTopic$(bridgeSocket$);

const bridgeStateWithTimings$ = getBridgeStateWithTimings$(
    bridgeStateTopic$,
    bridgeTimingsTopic$
);
void bridgeStateWithTimings$;

const nextFinalizationTarget$ = ethStateTopic$.pipe(take(1));

const depositProcessingStatus$ = nextFinalizationTarget$.pipe(
    take(1),
    map(
        ({ latest_finality_block_number }) => latest_finality_block_number + 10
    ),
    switchMap((target) =>
        getDepositProcessingStatus$(
            target,
            ethStateTopic$,
            bridgeStateTopic$,
            bridgeTimingsTopic$
        )
    )
);
void depositProcessingStatus$;
/*testSub(bridgeStateTopic$);
testSub(ethStateTopic$);
testSub(bridgeTimingsTopic$);
testSub(bridgeStateWithTimings$)*/

//testSub(ethStateTopic$);
//testSub(bridgeStateTopic$);

//testSub(bridgeSocketConnectionState$);
//testSub(depositProcessingStatus$);

testSub(bridgeSocket$);

testSub(
    getDepositProcessingStatus$(
        0,
        ethStateTopic$,
        bridgeStateTopic$,
        bridgeTimingsTopic$
    )
);
