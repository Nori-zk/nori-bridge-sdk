import {
    combineLatest,
    concat,
    distinctUntilChanged,
    interval,
    map,
    merge,
    scan,
    startWith,
    switchMap,
    withLatestFrom,
} from 'rxjs';
import {
    BridgeDepositProcessingStatus,
    depositProcessingStatus$,
} from './deposit.js';
import { waitForDepositFinalization$ } from '../eth/waitForDepositFinalization.js';
import { getEthStateTopic$ } from '../eth/topic.js';
import { getBridgeStateTopic$, getBridgeTimingsTopic$ } from './topics.js';
import { TransitionNoticeMessageType } from '@nori-zk/pts-types';

/*
export const combinedDepositProcessingStatus$ = (
  depositBlockNumber: number,
  ethStateTopic$: ReturnType<typeof getEthStateTopic$>,
  bridgeStateTopic$: ReturnType<typeof getBridgeStateTopic$>,
  bridgeTimingsTopic$: ReturnType<typeof getBridgeTimingsTopic$>
) => {
  const waitingForFinality$ = waitForDepositFinalization$(
    depositBlockNumber,
    ethStateTopic$
  ).pipe(
    withLatestFrom(bridgeStateTopic$),
    map(([countdown, bridgeState]) => ({
      ...bridgeState,
      time_remaining_sec: countdown,
      elapsed_sec: 384 - countdown,
      deposit_processing_status:
        BridgeDepositProcessingStatus.WaitingForEthFinality,
      deposit_block_number: depositBlockNumber,
    }))
  );

  const processingStatus$ = depositProcessingStatus$(
    depositBlockNumber,
    bridgeStateTopic$,
    bridgeTimingsTopic$
  );

  return concat(waitingForFinality$, processingStatus$);
};
*/

/*
export const combinedDepositProcessingStatus$ = (
    depositBlockNumber: number,
    ethStateTopic$: ReturnType<typeof getEthStateTopic$>,
    bridgeStateTopic$: ReturnType<typeof getBridgeStateTopic$>,
    bridgeTimingsTopic$: ReturnType<typeof getBridgeTimingsTopic$>
) => {
    const combinedBridge$ = combineLatest([
        bridgeStateTopic$,
        bridgeTimingsTopic$,
    ]).pipe(
        // Supress bridgeTimingsTopic changes unless bridgeStateTopic has changed
        distinctUntilChanged(
            (prev, curr) => JSON.stringify(prev[0]) === JSON.stringify(curr[0]) 
        )
    );


    // Combine eth state and bridgeState+Timings
    return combineLatest([ethStateTopic$, combinedBridge$]).pipe(
        map(([ethState, [bridgeState, bridgeTimings]]) => {
            const { latest_finality_slot, latest_finality_block_number } = ethState;

            // Waiting for finality
            if (latest_finality_block_number < depositBlockNumber) {
                // Calculate time remaining estimate
                const delta = latest_finality_slot - latest_finality_block_number;
                const depositSlot = depositBlockNumber + delta;
                const roundedSlot = Math.ceil(depositSlot / 32) * 32;
                const targetBlock = roundedSlot - delta;
                const blocksRemaining = targetBlock - latest_finality_block_number;
                const timeRemaining = Math.max(0, blocksRemaining * 12);

                // Return depositBlockNumber, bridgeState, WaitingForEthFinality status and timeRemaining
                return {
                    bridgeState,
                    depositProcessingStatus: BridgeDepositProcessingStatus.WaitingForEthFinality,
                    depositBlockNumber,
                    timeRemaining,
                    suppressEthState: false,
                };
            }

            // Finality reached
            const {
                stageName,
                elapsed_sec: bridgeElapsedSec,
                input_block_number,
                output_block_number,
            } = bridgeState;

            // Determine if the bridge is processing our window, if we have to wait, or if we missed the oppertunity
            let depositProcessingStatus: BridgeDepositProcessingStatus;
            if (
                input_block_number <= depositBlockNumber &&
                depositBlockNumber <= output_block_number
            ) {
                depositProcessingStatus = BridgeDepositProcessingStatus.WaitingForCurrentJobCompletion;
            } else if (output_block_number < depositBlockNumber) {
                depositProcessingStatus = BridgeDepositProcessingStatus.WaitingForPreviousJobCompletion;
            } else if (depositBlockNumber < input_block_number) {
                depositProcessingStatus = BridgeDepositProcessingStatus.MissedMintingOpportunity;
            } else {
                throw new Error('THIS SHOULD NOT HAPPEN');
            }

            // Calculate current state expection time
            const expectedDuration = bridgeTimings.extension[stageName] || 15;
            let timeRemaining = expectedDuration - bridgeElapsedSec;

            // Return depositBlockNumber, bridgeState, depositProcessingStatus status and timeRemaining
            return {
                bridgeState,
                depositProcessingStatus,
                depositBlockNumber,
                timeRemaining,
                suppressEthState: true,
            };
        }),

        // When we are pass finality we dont care about ethState changes anymore suppress them.
        distinctUntilChanged((prev, curr) => {
            if (curr.suppressEthState) {
                return (
                    JSON.stringify(prev.bridgeState) === JSON.stringify(curr.bridgeState) &&
                    prev.depositProcessingStatus === curr.depositProcessingStatus
                );
            }
            return false;
        }),

        switchMap(({ bridgeState, depositProcessingStatus, depositBlockNumber, timeRemaining }) => {
            // Start a countdown ticker for the current stage.
            return interval(1000).pipe(
                map((elapsedSec) => {
                    const { stageName } = bridgeState;
                    let adjustedTimeRemaining = timeRemaining - elapsedSec;

                    if (
                        stageName === TransitionNoticeMessageType.EthProcessorTransactionFinalizationSucceeded &&
                        depositProcessingStatus !== BridgeDepositProcessingStatus.WaitingForEthFinality
                    ) {
                        adjustedTimeRemaining = ((adjustedTimeRemaining % 384) + 384) % 384;
                    }

                    return {
                        ...bridgeState,
                        time_remaining_sec: adjustedTimeRemaining,
                        elapsed_sec: elapsedSec,
                        deposit_processing_status: depositProcessingStatus,
                        deposit_block_number: depositBlockNumber,
                    };
                })
            );
        })
    );
};
*/
 /*
last stage is complete when EthProcessorTransactionFinalizationSucceeded is finished  
 */

export const combinedDepositProcessingStatus$ = (
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
