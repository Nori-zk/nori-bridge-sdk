import {
    KeyTransitionStageMessageTypes,
    WebSocketServiceTopicSubscriptionMessage,
} from '@nori-zk/pts-types';
import { filter, map, Observable, shareReplay } from 'rxjs';
import { WebSocketSubject } from 'rxjs/webSocket';
import { ReconnectingWebSocketSubject } from './reconnectingSocket.js';

export const getBridgeStateTopic$ = (
    bridgeSocket$:
        | WebSocketSubject<WebSocketServiceTopicSubscriptionMessage>
        | ReconnectingWebSocketSubject<WebSocketServiceTopicSubscriptionMessage>
) =>
    (
        bridgeSocket$.asObservable().pipe(
            // Filter by topic and suppress events when the state is 'unknown'
            filter(
                (message) =>
                    message.topic === 'state.bridge' &&
                    message.extension.elapsed_sec !== 'unknown'
            ),
            map((message) => message.extension)
        ) as Observable<{
            stageName: KeyTransitionStageMessageTypes;
            input_slot: number;
            input_block_number: number;
            output_slot: number;
            output_block_number: number;
            elapsed_sec: number;
        }>
    ).pipe(shareReplay(1));

export const getBridgeTimingsTopic$ = (
    bridgeSocket$:
        | WebSocketSubject<WebSocketServiceTopicSubscriptionMessage>
        | ReconnectingWebSocketSubject<WebSocketServiceTopicSubscriptionMessage>
) =>
    bridgeSocket$
        .asObservable()
        .pipe(
            // Filter by topic and suppress events when the state is 'unknown'
            filter((message) => message.topic === 'timings.notices.transition')
        )
        .pipe(shareReplay(1));

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