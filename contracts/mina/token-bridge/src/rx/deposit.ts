import {
    combineLatest,
    concat,
    distinctUntilChanged,
    filter,
    firstValueFrom,
    interval,
    map,
    Observable,
    of,
    shareReplay,
    switchMap,
    take,
    takeWhile,
    tap,
} from 'rxjs';
import {
    getBridgeStateTopic$,
    getBridgeTimingsTopic$,
    getEthStateTopic$,
} from './topics.js';
import { TransitionNoticeMessageType } from '@nori-zk/pts-types';

/**
 * Represents the various processing states a bridge deposit can pass through before minting is possible or missed.
 *
 * - `WaitingForEthFinality`: The deposit is awaiting Ethereum chain finality before processing can begin.
 * - `WaitingForCurrentJobCompletion`: The deposit is included in the current bridge job but must wait for it to finalize.
 * - `WaitingForPreviousJobCompletion`: The deposit is not part of the current job and must wait for its job window to open.
 * - `ReadyToMint`: The deposit has passed all required stages and is now eligible for minting.
 * - `MissedMintingOpportunity`: The deposit missed its minting window.
 */
export enum BridgeDepositProcessingStatus {
    WaitingForEthFinality = 'WaitingForEthFinality',
    WaitingForCurrentJobCompletion = 'WaitingForCurrentJobCompletion',
    WaitingForPreviousJobCompletion = 'WaitingForPreviousJobCompletion',
    ReadyToMint = 'ReadyToMint',
    MissedMintingOpportunity = 'MissedMintingOpportunity',
}

/**
 * Monitors the status of a bridge deposit and emits a stream of updates regarding its processing state.
 *
 * The stream emits objects containing the current bridge state, estimated time remaining, elapsed time,
 * deposit processing status, and the original deposit block number. It transitions through various statuses such as
 * WaitingForEthFinality, WaitingForCurrentJobCompletion, ReadyToMint, or MissedMintingOpportunity.
 *
 * The observable completes once the deposit is considered a missed minting opportunity.
 *
 * @param depositBlockNumber     The block number in which the deposit occurred.
 * @param ethStateTopic$         Observable stream of Ethereum finality data.
 * @param bridgeStateTopic$      Observable stream of the bridge state machine.
 * @param bridgeTimingsTopic$    Observable stream of bridge timing configuration.
 * @returns An observable emitting periodic updates about the deposit's processing status.
 */
export const getDepositProcessingStatus$ = (
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

    // On each trigger, do one time / status computation and then switch to a single interval:
    const status$ = trigger$.pipe(
        map(([ethState, [bridgeState, bridgeTimings]]) => {
            // Determine status
            let status: BridgeDepositProcessingStatus;

            // Extract bridgeState properties
            const {
                stage_name,
                elapsed_sec,
                input_block_number,
                output_block_number,
            } = bridgeState;

            if (ethState.latest_finality_block_number < depositBlockNumber) {
                status = BridgeDepositProcessingStatus.WaitingForEthFinality;
            } else {
                if (
                    input_block_number <= depositBlockNumber &&
                    depositBlockNumber <= output_block_number
                ) {
                    if (
                        stage_name ===
                        TransitionNoticeMessageType.EthProcessorTransactionFinalizationSucceeded
                    )
                        status = BridgeDepositProcessingStatus.ReadyToMint;
                    else
                        status =
                            BridgeDepositProcessingStatus.WaitingForCurrentJobCompletion;
                } else if (output_block_number < depositBlockNumber) {
                    status =
                        BridgeDepositProcessingStatus.WaitingForPreviousJobCompletion;
                } else {
                    // if (despositBlockNumber < input_block_number)
                    // Here we might still be ready to mint if our last finalized job includes our deposit in its window
                    // AND the current job has not reached TransitionNoticeMessageType.EthProcessorTransactionFinalizationSucceeded
                    if (bridgeState.last_finalized_job === 'unknown') {
                        // Due to a server restart we don't know what our finalized job was we can only assume that
                        // we missed our minting opportunity.
                        status =
                            BridgeDepositProcessingStatus.MissedMintingOpportunity;
                    } else {
                        const {
                            input_block_number: last_input_block_number,
                            output_block_number: last_output_block_number,
                        } = bridgeState.last_finalized_job;
                        // If the deposit was in the last finalized job window but the current job has not been finalized then we can still mint
                        if (
                            last_input_block_number <= depositBlockNumber &&
                            depositBlockNumber <= last_output_block_number &&
                            stage_name !==
                                TransitionNoticeMessageType.EthProcessorTransactionFinalizationSucceeded
                        ) {
                            status = BridgeDepositProcessingStatus.ReadyToMint;
                        } else {
                            status =
                                BridgeDepositProcessingStatus.MissedMintingOpportunity;
                        }
                    }
                }
            }

            // Do time estimate computation
            let timeToWait: number;

            if (
                status === BridgeDepositProcessingStatus.WaitingForEthFinality
            ) {
                const delta =
                    ethState.latest_finality_slot -
                    ethState.latest_finality_block_number;
                const depositSlot = depositBlockNumber + delta;
                const rounded = Math.ceil(depositSlot / 32) * 32;
                const blocksRemaining =
                    rounded - delta - ethState.latest_finality_block_number;
                timeToWait = Math.max(0, blocksRemaining * 12);
            } else {
                const expected = bridgeTimings.extension[stage_name] ?? 15;
                timeToWait = expected - elapsed_sec;
            }

            return { status, bridgeState, timeToWait };
        }),
        // Complete if we have MissedMintingOpportunity or if we are ReadyToMint
        takeWhile(
            ({ status }) =>
                !(
                    status ===
                    BridgeDepositProcessingStatus.MissedMintingOpportunity
                ),
            true
        )
    );

    return status$.pipe(
        switchMap(({ status, bridgeState, timeToWait }) => {
            return concat(
                of(0), // emit immediately
                interval(1000) // then every 1s
            ).pipe(
                // Complete if we have MissedMintingOpportunity or if we are ReadyToMint
                takeWhile(
                    () =>
                        !(
                            status ===
                            BridgeDepositProcessingStatus.MissedMintingOpportunity
                        ),
                    true
                ),
                // Calculate timeRemaining
                map((tick) => {
                    let timeRemaining = timeToWait - tick + 1;
                    if (
                        bridgeState.stage_name ===
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
        }),
        shareReplay(1)
    );
};

/**
 * Waits until a deposit reaches the `ReadyToMint` status, or throws if the opportunity is missed.
 *
 * Resolves as soon as the deposit processing status becomes `ReadyToMint`. Throws an error
 * if the deposit transitions to `MissedMintingOpportunity` instead.
 *
 * @param depositProcessingStatus$ Observable emitting deposit processing updates.
 * @returns A promise resolving to true once the deposit is ready to mint.
 * @throws Error if the minting opportunity is missed.
 */
export async function canMint(
    depositProcessingStatus$: ReturnType<typeof getDepositProcessingStatus$>
) {
    return firstValueFrom(
        depositProcessingStatus$.pipe(
            // Error if we have missed our minting opportunity
            tap(({ deposit_processing_status }) => {
                if (
                    deposit_processing_status ===
                    BridgeDepositProcessingStatus.MissedMintingOpportunity
                ) {
                    throw new Error('Minting opportunity missed.');
                }
            }),
            // Wait for ReadyToMint before resolving
            filter(
                ({ deposit_processing_status }) =>
                    deposit_processing_status ===
                    BridgeDepositProcessingStatus.ReadyToMint
            ),
            // Only take one event
            take(1),
            // Map to a boolean
            map(() => true)
        )
    );
}

/**
 * Waits until the deposit is eligible for mint proof generation, based on bridge state.
 *
 * Specifically, waits for the deposit status to become `WaitingForCurrentJobCompletion`
 * and the bridge stage to be `ProofConversionJobSucceeded`.
 * Throws if the deposit becomes a missed minting opportunity before that.
 *
 * @param depositProcessingStatus$ Observable emitting deposit processing updates.
 * @returns A promise resolving to true when mint proof generation is ready.
 * @throws Error if the minting opportunity is missed.
 */
export function readyToComputeMintProof(
    depositProcessingStatus$: ReturnType<typeof getDepositProcessingStatus$>
) {
    return firstValueFrom(
        depositProcessingStatus$.pipe(
            // Error if we have missed our minting opportunity
            tap(({ deposit_processing_status }) => {
                if (
                    deposit_processing_status ===
                    BridgeDepositProcessingStatus.MissedMintingOpportunity
                ) {
                    throw new Error('Minting opportunity missed.');
                }
            }),
            // Wait for WaitingForCurrentJobCompletion and ProofConversionJobSucceeded before resolving
            filter(
                ({ deposit_processing_status, stage_name }) =>
                    deposit_processing_status ===
                        BridgeDepositProcessingStatus.WaitingForCurrentJobCompletion &&
                    stage_name ===
                        TransitionNoticeMessageType.ProofConversionJobSucceeded
            ),
            take(1),
            map(() => true)
        )
    );
}

/**
 * Waits for the next combined emission of Ethereum finalization state, bridge state, and bridge timing data.
 *
 * **Unsafe Method Warning:** Awaiting this function before calling getDepositProcessingStatus may incorrectly
 * identify a deposit as having missed its minting opportunity if the bridge has finalized the deposit’s proof
 * window, started processing a new job that has not yet emitted an `EthProcessorTransactionFinalizationSucceeded`
 * transition notice, and a websocket server restart caused loss of the last finalized job state. However, using
 * the safe method may require the user to wait for the current bridge job to complete, which could take many minutes,
 * before locking is allowed.
 *
 * Using this “unsafe” method trades accuracy for speed: it returns as soon as all three streams emit once,
 * potentially allowing a user to lock sooner, at the risk of misclassification of the deposit status.
 *
 * @param ethStateTopic$      Observable stream of Ethereum finalization state.
 * @param bridgeStateTopic$   Observable stream of the bridge’s processing state.
 * @param bridgeTimingsTopic$ Observable stream of the bridge’s timing parameters.
 * @returns A promise resolving to a tuple [ethState, bridgeState, bridgeTimings] containing the latest
 *          values from each stream.
 */
export function bridgeStatusesKnownEnoughToLockUnsafe(
    ethStateTopic$: ReturnType<typeof getEthStateTopic$>,
    bridgeStateTopic$: ReturnType<typeof getBridgeStateTopic$>,
    bridgeTimingsTopic$: ReturnType<typeof getBridgeTimingsTopic$>
) {
    return firstValueFrom(
        combineLatest([ethStateTopic$, bridgeStateTopic$, bridgeTimingsTopic$])
    );
}

/**
 * Waits for the next combined emission of Ethereum finalization state, bridge state, and bridge timing data,
 * ensuring that the last finalized bridge job is known before resolving.
 *
 * **Safe Method Guarantee:** Awaiting this function guarantees accurate classification of the deposit status
 * when using the getDepositProcessingStatus function by waiting until the bridge reports a known `last_finalized_job`.
 * This ensures the minting opportunity window for the deposit can be definitively determined.
 *
 * This prevents unsafe assumptions that could occur if the bridge has finalized the deposit’s proof window
 * and started processing a new job, **and** a websocket server restart caused loss of the last finalized job state—
 * leading to incorrect classification of the current deposit as having missed its minting opportunity.
 *
 * However, this safety comes at the cost of responsiveness: users may be forced to wait until the current job
 * has been finalized (which may take up to 30 minutes) before locking is permitted.
 *
 * This method prioritizes correctness over responsiveness, and should be used in user-facing flows where
 * reliable deposit status is required.
 *
 * @param ethStateTopic$      Observable stream of Ethereum finalization state.
 * @param bridgeStateTopic$   Observable stream of the bridge’s processing state.
 * @param bridgeTimingsTopic$ Observable stream of the bridge’s timing parameters.
 * @returns A promise resolving to a tuple [ethState, bridgeState, bridgeTimings] only when the last
 *          finalized job is known.
 */
export function bridgeStatusesKnownEnoughToLockSafe(
    ethStateTopic$: ReturnType<typeof getEthStateTopic$>,
    bridgeStateTopic$: ReturnType<typeof getBridgeStateTopic$>,
    bridgeTimingsTopic$: ReturnType<typeof getBridgeTimingsTopic$>
) {
    return firstValueFrom(
        combineLatest([
            ethStateTopic$,
            bridgeStateTopic$,
            bridgeTimingsTopic$,
        ]).pipe(
            filter(([_, bridgeState, __]) => {
                return bridgeState.last_finalized_job !== 'unknown';
            })
        )
    );
}
