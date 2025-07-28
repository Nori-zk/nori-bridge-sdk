import {
    combineLatest,
    distinctUntilChanged,
    interval,
    map,
    switchMap,
} from 'rxjs';
import { getEthStateTopic$ } from '../eth/topic.js';
import { getBridgeStateTopic$, getBridgeTimingsTopic$ } from './topics.js';
import { TransitionNoticeMessageType } from '@nori-zk/pts-types';

export enum BridgeDepositProcessingStatus {
    WaitingForEthFinality = 'WaitingForEthFinality',
    WaitingForCurrentJobCompletion = 'WaitingForCurrentJobCompletion',
    WaitingForPreviousJobCompletion = 'WaitingForPreviousJobCompletion',
    ReadyToMint = 'ReadyToMint',
    MissedMintingOpportunity = 'MissedMintingOpportunity',
}

//last stage is complete when EthProcessorTransactionFinalizationSucceeded is finished

export const depositProcessingStatus$ = (
    depositBlockNumber: number,
    ethStateTopic$: ReturnType<typeof getEthStateTopic$>,
    bridgeStateTopic$: ReturnType<typeof getBridgeStateTopic$>,
    bridgeTimingsTopic$: ReturnType<typeof getBridgeTimingsTopic$>
) => {
    // Only react when bridgeState actually changes:
    const combinedBridge$ = combineLatest([
        bridgeStateTopic$,
        bridgeTimingsTopic$,
    ]).pipe(
        distinctUntilChanged(
            (prev, curr) => JSON.stringify(prev[0]) === JSON.stringify(curr[0])
        )
    );

    // Combine ethState with that, but once we're past finality waiting,
    // ignore ethState only updates:
    const trigger$ = combineLatest([ethStateTopic$, combinedBridge$]).pipe(
        distinctUntilChanged((prev, curr) => {
            const [prevEth, [prevBridge, prevTimings]] = prev;
            const [currEth, [currBridge, currTimings]] = curr;

            const wasWaiting =
                prevEth.latest_finality_block_number < depositBlockNumber;
            const isWaiting =
                currEth.latest_finality_block_number < depositBlockNumber;

            // if we’ve left “waiting” mode, ignore eth-only changes:
            if (!isWaiting && !wasWaiting) {
                return (
                    JSON.stringify(prevBridge) === JSON.stringify(currBridge) &&
                    JSON.stringify(prevTimings) === JSON.stringify(currTimings)
                );
            }
            // otherwise (during waiting or on transition) always fire
            return false;
        })
    );

    // On each trigger, do one compute and then switch to a single interval:
    return trigger$.pipe(
        switchMap(([ethState, [bridgeState, bridgeTimings]]) => {
            let timeToWait: number;
            let status: BridgeDepositProcessingStatus;

            if (ethState.latest_finality_block_number < depositBlockNumber) {
                const delta =
                    ethState.latest_finality_slot -
                    ethState.latest_finality_block_number;
                const depositSlot = depositBlockNumber + delta;
                const rounded = Math.ceil(depositSlot / 32) * 32;
                const blocksRemaining =
                    rounded - delta - ethState.latest_finality_block_number;
                timeToWait = Math.max(0, blocksRemaining * 12);
                status = BridgeDepositProcessingStatus.WaitingForEthFinality;
            } else {
                const {
                    stageName,
                    elapsed_sec,
                    input_block_number,
                    output_block_number,
                } = bridgeState;

                if (
                    input_block_number <= depositBlockNumber &&
                    depositBlockNumber <= output_block_number
                ) {
                    status =
                        BridgeDepositProcessingStatus.WaitingForCurrentJobCompletion;
                } else if (output_block_number < depositBlockNumber) {
                    status =
                        BridgeDepositProcessingStatus.WaitingForPreviousJobCompletion;
                } else {
                    status =
                        BridgeDepositProcessingStatus.MissedMintingOpportunity;
                }

                const expected = bridgeTimings.extension[stageName] ?? 15;
                timeToWait = expected - elapsed_sec;
            }

            return interval(1000).pipe(
                map((tick) => {
                    let timeRemaining = timeToWait - tick;
                    if (
                        bridgeState.stageName ===
                            TransitionNoticeMessageType.EthProcessorTransactionFinalizationSucceeded &&
                        status !==
                            BridgeDepositProcessingStatus.WaitingForEthFinality
                    ) {
                        timeRemaining = ((timeRemaining % 384) + 384) % 384;
                    }

                    return {
                        ...bridgeState,
                        time_remaining_sec: timeRemaining,
                        elapsed_sec: tick,
                        deposit_processing_status: status,
                        deposit_block_number: depositBlockNumber,
                    };
                })
            );
        })
    );
};
