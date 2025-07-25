import { first, Observable, switchMap, take } from 'rxjs';
import { getBridgeSocket$ } from './bridge/socket.js';
import { getEthStateTopic$ } from './eth/topic.js';
import {
    getBridgeStateTopic$,
    getBridgeTimingsTopic$,
} from './bridge/topics.js';
import { getBridgeStateWithTimings$ } from './bridge/state.js';
import { waitForDepositFinalization$ } from './eth/waitForDepositFinalization.js';

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

const nextFinalization$ = ethStateTopic$.pipe(
    take(1),
    switchMap(({ latest_finality_block_number }) => {
        console.log('in final', latest_finality_block_number - 63);
        return waitForDepositFinalization$(
            latest_finality_block_number + 10,
            ethStateTopic$
        );
    })
);

/*;*/
//testSub(depositFinalization$);

/*testSub(bridgeStateTopic$);
testSub(ethStateTopic$);
testSub(bridgeTimingsTopic$);
testSub(bridgeStateWithTimings$)*/

testSub(nextFinalization$);
testSub(ethStateTopic$);
