import {
    KeyTransitionStageMessageTypes,
    WebSocketServiceTopicSubscriptionMessage,
} from '@nori-zk/pts-types';
import { filter, map, Observable, shareReplay } from 'rxjs';
import { WebSocketSubject } from 'rxjs/webSocket';
import { ReconnectingWebSocketSubject } from './reconnectingSocket.js';

/**
 * Returns an observable emitting the bridge's current processing state.
 *
 * Filters for messages from the `state.bridge` topic, ignoring any with `elapsed_sec`
 * set to `'unknown'`, as those do not represent valid state data.
 *
 * The observable emits objects containing the current stage, slot/block input/output
 * positions, elapsed time in seconds, and details about the last finalized job—
 * if known.
 *
 * The stream is shared and replayed to all subscribers using `shareReplay(1)`.
 *
 * @param bridgeSocket$ WebSocket connection to the bridge service.
 * @returns Observable emitting bridge state updates.
 */
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
            stage_name: KeyTransitionStageMessageTypes;
            input_slot: number;
            input_block_number: number;
            output_slot: number;
            output_block_number: number;
            elapsed_sec: number;
            last_finalized_job:
                | 'unknown'
                | {
                      input_slot: number;
                      input_block_number: number;
                      output_slot: number;
                      output_block_number: number;
                  };
        }>
    ).pipe(shareReplay(1));

/**
 * Returns an observable emitting bridge timing data related to transition notices.
 *
 * Filters for messages from the `timings.notices.transition` topic.
 * Emits raw transition timing metadata from the bridge without transformation.
 *
 * The stream is shared and replayed to all subscribers using `shareReplay(1)`.
 *
 * @param bridgeSocket$ WebSocket connection to the bridge service.
 * @returns Observable emitting transition timing updates.
 */
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

/**
 * Returns an observable emitting the current Ethereum finality state.
 *
 * Filters for messages from the `state.eth` topic, discarding any with
 * `latest_finality_block_number` set to `'unknown'`.
 *
 * Emits the latest known finality slot and block number from the Ethereum network.
 * The stream is shared and replayed to all subscribers using `shareReplay(1)`.
 *
 * @param bridgeSocket$ WebSocket connection to the bridge service.
 * @returns Observable emitting Ethereum finality state updates.
 */
export const getEthStateTopic$ = (
    bridgeSocket$:
        | WebSocketSubject<WebSocketServiceTopicSubscriptionMessage>
        | ReconnectingWebSocketSubject<WebSocketServiceTopicSubscriptionMessage>
) =>
    (
        bridgeSocket$.asObservable().pipe(
            // Filter by topic and suppress events when the state is 'unknown'
            filter(
                (message) =>
                    message.topic === 'state.eth' &&
                    message.extension.latest_finality_block_number !== 'unknown'
            ),
            map((message) => message.extension)
        ) as Observable<{
            latest_finality_block_number: number;
            latest_finality_slot: number;
        }>
    ).pipe(shareReplay(1));
