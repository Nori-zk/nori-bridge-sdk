import { WebSocketServiceTopicSubscriptionMessage } from '@nori-zk/pts-types';
import { filter, interval, map, Subscription } from 'rxjs';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';
import { reconnectingWebSocket, ReconnectingWebSocketSubject } from './reconnectingSocket.js';

export { type ReconnectingWebSocketSubject };

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

/**
 * Creates a basic `WebSocketSubject` for receiving bridge-related messages.
 * 
 * This socket:
 * - Subscribes to `state.eth`, `state.bridge`, and `timings.notices.transition` on open.
 * - Sends `ping` messages at a fixed interval (heartbeat).
 * - Ignores `pong` replies in the message stream.
 *
 * Automatically unsubscribes from heartbeat pings on socket close.
 *
 * @param url WebSocket server URL (default: wss://wss.nori.it.com)
 * @param heartBeatInterval Interval for heartbeat pings in ms (default: 3000)
 * @returns A filtered WebSocketSubject that emits structured subscription messages.
 */
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

/**
 * Creates a reconnecting WebSocketSubject that:
 * - Handles connection state tracking and automatic reconnect with exponential backoff
 * - Sends regular `ping` heartbeats
 * - Watches for missing `pong` responses and triggers reconnection if threshold is exceeded
 * - Subscribes to key bridge-related topics on connection
 * - Filters out pong replies from message stream
 *
 * @param url WebSocket server URL (default: wss://wss.nori.it.com)
 * @param heartBeatInterval Interval in ms for sending pings (default: 3000)
 * @param pongTimeoutMultiplier Multiplier to determine allowed pong delay before reconnection (default: 2)
 * @returns An object containing:
 *   - `bridgeSocket$`: the reconnecting WebSocket observable for bridge messages
 *   - `bridgeSocketConnectionState$`: connection state observable
 */
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