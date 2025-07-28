import { WebSocketServiceTopicSubscriptionMessage } from '@nori-zk/pts-types';
import { filter, map, Observable, shareReplay } from 'rxjs';
import { WebSocketSubject } from 'rxjs/webSocket';
import { ReconnectingWebSocketSubject } from '../bridge/reconnectingSocket.js';

export const getEthStateTopic$ = (
    bridgeSocket$:
            | WebSocketSubject<WebSocketServiceTopicSubscriptionMessage>
            | ReconnectingWebSocketSubject<WebSocketServiceTopicSubscriptionMessage>
) =>
    (bridgeSocket$.asObservable().pipe(
        // Filter by topic and suppress events when the state is 'unknown'
        filter(
            (message) =>
                message.topic === 'state.eth' &&
                message.extension.latest_finality_block_number !== 'unknown'
        ),
        map((message) => message.extension),
    ) as Observable<{
        latest_finality_block_number: number;
        latest_finality_slot: number;
    }>).pipe(shareReplay(1));;
