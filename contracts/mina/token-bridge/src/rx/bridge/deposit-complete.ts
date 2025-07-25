import {
    combineLatest,
    concat,
    distinctUntilChanged,
    interval,
    map,
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
        distinctUntilChanged(
            (prev, curr) => JSON.stringify(prev[0]) === JSON.stringify(curr[0])
        )
    );

    return combineLatest([ethStateTopic$, combinedBridge$]).pipe(
        map(([ethState, [bridgeState, bridgeTimings]]) => {
            const { latest_finality_slot, latest_finality_block_number } = ethState;

            if (latest_finality_block_number < depositBlockNumber) {
                // Waiting for finality
                const delta = latest_finality_slot - latest_finality_block_number;
                const depositSlot = depositBlockNumber + delta;
                const roundedSlot = Math.ceil(depositSlot / 32) * 32;
                const targetBlock = roundedSlot - delta;
                const blocksRemaining = targetBlock - latest_finality_block_number;
                const timeRemaining = Math.max(0, blocksRemaining * 12);

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

            const expectedDuration = bridgeTimings.extension[stageName] || 15;
            let timeRemaining = expectedDuration - bridgeElapsedSec;

            return {
                bridgeState,
                depositProcessingStatus,
                depositBlockNumber,
                timeRemaining,
                suppressEthState: true,
            };
        }),

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
