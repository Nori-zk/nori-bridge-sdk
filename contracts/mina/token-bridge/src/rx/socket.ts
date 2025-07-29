import { WebSocketServiceTopicSubscriptionMessage } from '@nori-zk/pts-types';
import { filter, interval, map, shareReplay, Subscription } from 'rxjs';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';
import { reconnectingWebSocket, ReconnectingWebSocketSubject } from './reconnectingSocket.js';

// Pong response.
const pongReplyStr = '{"data":"pong"}';

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
        filter((messageStr) => messageStr !== pongReplyStr),
        map(
            (message) =>
                JSON.parse(
                    message as string
                ) as WebSocketServiceTopicSubscriptionMessage
        ),
    ) as WebSocketSubject<WebSocketServiceTopicSubscriptionMessage>;
}

export function getReconnectingBridgeSocket$(
    url: string = 'wss://wss.nori.it.com',
    heartBeatInterval: number = 3000,
    pongTimeoutMultiplier: number = 2
) {
    const { webSocket$: bridgeSocket$, webSocketConnectionState$ } = reconnectingWebSocket<string | object>({
        url,
        openObserver: {
            next: () => {
                lastPongReceived = Date.now();
                if (heartBeatInterval) {
                    heartbeatPingSub = heartBeatPing.subscribe();
                    pongTimeoutCheckSub = pongTimeoutCheck.subscribe();
                }
                bridgeSocket$.next(subscribeStateEth);
                bridgeSocket$.next(subscribeStateBridge);
                bridgeSocket$.next(subscribeTimingsTransition);
            },
        },
        closeObserver: {
            next: () => {
                heartbeatPingSub?.unsubscribe();
                pongTimeoutCheckSub?.unsubscribe();
            },
        },
        deserializer: (e) => e.data,
    });

    let lastPongReceived = Date.now();
    let heartbeatPingSub: Subscription;
    let pongTimeoutCheckSub: Subscription;

    // Heartbeat
    const heartBeatPing = interval(heartBeatInterval).pipe(
        map(() => bridgeSocket$.next({ method: 'ping' }))
    );

    // Detect bad connecions
    const pongTimeoutThreshold = heartBeatInterval * pongTimeoutMultiplier;
    const pongTimeoutCheck = interval(heartBeatInterval).pipe(
        map(() => {
            const now = Date.now();
            if (now - lastPongReceived > pongTimeoutThreshold) {
                bridgeSocket$.forceReconnect();
            }
        })
    );

    // Listen for pong replies and update timestamp
    const finalSocket$ = bridgeSocket$.pipe(
        map((messageStr) => {
            if (messageStr === pongReplyStr) {
                lastPongReceived = Date.now();
                return null;
            }
            return JSON.parse(messageStr as string) as WebSocketServiceTopicSubscriptionMessage;
        }),
        filter((msg): msg is WebSocketServiceTopicSubscriptionMessage => msg !== null)
    ) as ReconnectingWebSocketSubject<WebSocketServiceTopicSubscriptionMessage>;

    return {
        bridgeSocket$: finalSocket$,
        bridgeSocketConnectionState$: webSocketConnectionState$,
    };
}