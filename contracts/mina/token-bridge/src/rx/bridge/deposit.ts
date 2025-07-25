import {
    combineLatest,
    distinctUntilChanged,
    interval,
    map,
    scan,
    switchMap,
} from 'rxjs';
import { getBridgeStateWithTimings$ } from './state.js';
import { getBridgeStateTopic$, getBridgeTimingsTopic$ } from './topics.js';
import { TransitionNoticeMessageType } from '@nori-zk/pts-types';

export enum BridgeDepositProcessingStatus {
    WaitingForEthFinality = 'WaitingForEthFinality', // TODO LATER PERHAPS MAKE THIS HERE TO UNIFY THE WAITING OBS
    WaitingForCurrentJobCompletion = 'WaitingForCurrentJobCompletion',
    WaitingForPreviousJobCompletion = 'WaitingForPreviousJobCompletion',
    ReadyToMint = 'ReadyToMint',
    MissedMintingOpportunity = 'MissedMintingOpportunity',
}

const depositProcessingStatus = (
    depositBlockNumber: number,
    bridgeStateWithTimings$: ReturnType<typeof getBridgeStateWithTimings$>
) => bridgeStateWithTimings$.pipe();

export const depositProcessingStatus$ = (
    depositBlockNumber: number,
    bridgeStateTopic$: ReturnType<typeof getBridgeStateTopic$>,
    bridgeTimingsTopic$: ReturnType<typeof getBridgeTimingsTopic$>
) =>
    // Ensure both topics have fired and merge them into a single observable
    combineLatest([bridgeStateTopic$, bridgeTimingsTopic$]).pipe(
        // Supress bridgeTimingsTopic$ changes until bridgeStateTopic$ changes.
        distinctUntilChanged(
            (prev, curr) => JSON.stringify(prev[0]) === JSON.stringify(curr[0])
        ),
        // Determine deposit processing status and calculate the time remaining
        map(([bridgeState, bridgeTimings]) => {
            // FIXME this mixed casing is awful.
            const {
                stageName,
                elapsed_sec,
                input_block_number,
                output_block_number,
            } = bridgeState;

            // Determine BridgeDepositProcessingStatus
            let depositProcessingStatus: BridgeDepositProcessingStatus;
            if (
                input_block_number <= depositBlockNumber &&
                depositBlockNumber <= output_block_number
            ) {
                // Deposit is in the current job window
                depositProcessingStatus =
                    BridgeDepositProcessingStatus.WaitingForCurrentJobCompletion;
            } else if (output_block_number < depositBlockNumber) {
                // Job has not yet reached the deposit
                depositProcessingStatus =
                    BridgeDepositProcessingStatus.WaitingForPreviousJobCompletion;
            } else if (depositBlockNumber < input_block_number) {
                // Deposit missed the job window
                depositProcessingStatus =
                    BridgeDepositProcessingStatus.MissedMintingOpportunity;
            } else {
                throw new Error('THIS SHOULD NOT HAPPEN');
            }

            // Calculate time remaining for this stage
            const expectedDuration = bridgeTimings.extension[stageName] || 15;
            let timeRemaining = expectedDuration - elapsed_sec;
            return { bridgeState, timeRemaining, depositProcessingStatus };
        }),
        // Emit bridgeState with time_remaining_sec and elapsed_sec countdown.
        switchMap(({ bridgeState, timeRemaining, depositProcessingStatus }) => {
            return interval(1000).pipe(
                map((elapsedSeconds) => {
                    let adjustedTimeRemaining = timeRemaining - elapsedSeconds;

                    if (
                        bridgeState.stageName ===
                        TransitionNoticeMessageType.EthProcessorTransactionFinalizationSucceeded
                    ) {
                        // Apply modulo cycling when in finalization succeeded stage
                        adjustedTimeRemaining =
                            ((adjustedTimeRemaining % 384) + 384) % 384;
                    }
                    // Otherwise, allow negative timeRemaining

                    return {
                        ...bridgeState,
                        time_remaining_sec: adjustedTimeRemaining,
                        elapsed_sec: elapsedSeconds,
                        deposit_processing_status: depositProcessingStatus,
                        deposit_block_number: depositBlockNumber,
                    };
                })
            );
        })
    );

/*
 switchMap(({ bridgeState, timeRemaining, depositProcessingStatus }) => {
            return interval(1000).pipe(
                map((elapsedSeconds) => ({
                    ...bridgeState,
                    time_remaining_sec: timeRemaining - elapsedSeconds,
                    elapsed_sec: elapsedSeconds,
                    deposit_processing_status: depositProcessingStatus,
                }))
            );
        })
    */
