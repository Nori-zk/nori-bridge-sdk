import { WebSocketServiceTopicSubscriptionMessage } from '@nori-zk/pts-types';
import { filter, interval, map, shareReplay, Subscription } from 'rxjs';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';

// Pong response.

const pongReply = '{"data":"pong"}';

// Subscription requests.
const subscribeStateEth = {
    method: 'subscribe',
    topic: 'state.eth',
};
const subscribeStateBridge = {
    method: 'subscribe',
    topic: 'state.bridge',
};
const subscribeTimingsTransition = {
    method: 'subscribe',
    topic: 'timings.notices.transition',
};

// Make socket connection
export function getBridgeSocket$(
    url: string = 'wss://wss.nori.it.com',
    heartBeatInterval: number = 3000
) {
    const heartBeatPing = interval(heartBeatInterval).pipe(
        map(() => bridgeSocket$.next({ method: 'ping' }))
    );
    let heatBeatPingSub: Subscription;
    const bridgeSocket$ = webSocket<string | object>({
        url,
        openObserver: {
            next: () => {
                if (heartBeatInterval)
                    heatBeatPingSub = heartBeatPing.subscribe();
                bridgeSocket$.next(subscribeStateEth);
                bridgeSocket$.next(subscribeStateBridge);
                bridgeSocket$.next(subscribeTimingsTransition);
            },
        },
        closeObserver: {
            next: () => {
                if (heatBeatPingSub) heatBeatPingSub.unsubscribe();
            },
        },
        deserializer: (e) => e.data,
    });
    return bridgeSocket$.pipe(
        filter((messageStr) => messageStr !== pongReply),
        map(
            (message) =>
                JSON.parse(
                    message as string
                ) as WebSocketServiceTopicSubscriptionMessage
        ),
    ) as WebSocketSubject<WebSocketServiceTopicSubscriptionMessage>;
}
