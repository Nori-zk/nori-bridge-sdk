import { map, Observable, switchMap, take } from 'rxjs';
import { getReconnectingBridgeSocket$ } from './socket.js';
import {
    getBridgeStateTopic$,
    getBridgeTimingsTopic$,
    getEthStateTopic$
} from './topics.js';
import { getBridgeStateWithTimings$ } from './state.js';
import { getDepositProcessingStatus$ } from './deposit.js';
import { ReconnectingWebSocketSubject } from './reconnectingSocket.js';

// Util for testing Obserables
function testSub($: Observable<any>) {
    $.subscribe({
        error: console.error,
        next: console.log,
        complete: () => console.log('complete'),
    });
}

const { bridgeSocket$, bridgeSocketConnectionState$ } = getReconnectingBridgeSocket$();

const bridgeStateTopic$ = getBridgeStateTopic$(bridgeSocket$);
const bridgeTimingsTopic$ = getBridgeTimingsTopic$(bridgeSocket$);
const ethStateTopic$ = getEthStateTopic$(bridgeSocket$);

const bridgeStateWithTimings$ = getBridgeStateWithTimings$(
    bridgeStateTopic$,
    bridgeTimingsTopic$
);

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

/*testSub(bridgeStateTopic$);
testSub(ethStateTopic$);
testSub(bridgeTimingsTopic$);
testSub(bridgeStateWithTimings$)*/

//testSub(ethStateTopic$);
testSub(bridgeStateTopic$);

//testSub(bridgeSocketConnectionState$);
testSub(depositProcessingStatus$);

