import {
    combineLatest,
    concat,
    distinctUntilChanged,
    filter,
    firstValueFrom,
    interval,
    map,
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
import {
    KeyTransitionStageMessageTypes,
    TransitionNoticeMessageType,
} from '@nori-zk/pts-types';

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
    // Indeterminate
}

function stageIndex(stage: TransitionNoticeMessageType) {
    return KeyTransitionStageMessageTypes.indexOf(
        stage as unknown as KeyTransitionStageMessageTypes
    ); // Could be absent
}

// Index of key stages

// At this stage we can create our eth proof if we are at WaitingForCurrentJobCompletion
const stageIndexProofConversionJobSucceeded = stageIndex(
    TransitionNoticeMessageType.ProofConversionJobSucceeded
);

// At this stage if our deposit was in the last window it is unsafe to mint as Eth processor's storage root would be inconsistent.
const stageIndexEthProcessorTransactionSubmitSucceeded = stageIndex(
    TransitionNoticeMessageType.EthProcessorTransactionSubmitSucceeded
);

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
                        // Due to a server restart we don't know what our last finalized job was we can only assume that
                        // we missed our minting opportunity.
                        status =
                            BridgeDepositProcessingStatus.MissedMintingOpportunity;
                    } else {
                        const {
                            input_block_number: last_input_block_number,
                            output_block_number: last_output_block_number,
                        } = bridgeState.last_finalized_job;

                        const stageIdx = stageIndex(stage_name);

                        // If the deposit was in the last finalized job window and the current job has not been finalized then we can still mint
                        // FIXME this could still break! Instead we should do < Submitting stage
                        //if (stageIdx === -1) // Indeterminate (but looking at what events we actually omit we shouldnt actually have any missing.)

                        // Turn to else if (something like this....)
                        /*
                            // Our deposit was in the last window
                            last_input_block_number <= depositBlockNumber &&
                            depositBlockNumber <= last_output_block_number &&
                            // Our stage index is less than stageIndexEthProcessorTransactionSubmitSucceeded
                            stageIdx < stageIndexEthProcessorTransactionSubmitSucceeded &&
                            // Our last stage is not the same as our current stage. (But think about this.... if we are looking current job we wont get here
                            and the below is only true when we were processed in the last job when isn't stageIndexEthProcessorTransactionSubmitSucceeded which is where
                            the previous and current blocks are the same.... so i think the last condition here is probably not a desirable constraint)
                            !(last_input_block_number ===
                                input_block_number &&
                            last_output_block_number ===
                                output_block_number)
                        */
                        if (
                            last_input_block_number <= depositBlockNumber &&
                            depositBlockNumber <= last_output_block_number &&
                            stageIdx <
                                stageIndexEthProcessorTransactionSubmitSucceeded
                            //stage_name !==
                            //    TransitionNoticeMessageType.EthProcessorTransactionFinalizationSucceeded // This may be too late!
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
        // Complete if we have MissedMintingOpportunity
        takeWhile(
            ({ status }) =>
                status !==
                BridgeDepositProcessingStatus.MissedMintingOpportunity,
            true
        )
    );

    return status$.pipe(
        switchMap(({ status, bridgeState, timeToWait }) => {
            return concat(
                of(0), // emit immediately
                interval(1000) // then every 1s
            ).pipe(
                // Complete if we have MissedMintingOpportunity
                takeWhile(
                    () =>
                        status !==
                        BridgeDepositProcessingStatus.MissedMintingOpportunity,
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

// Implement a trinary this version just works out our stage between ready, missed and a generic 'waiting'
const canMintStatus = [
    BridgeDepositProcessingStatus.MissedMintingOpportunity,
    BridgeDepositProcessingStatus.ReadyToMint,
    'Waiting',
] as const;
const canMintWaitingStatuses = [
    BridgeDepositProcessingStatus.WaitingForCurrentJobCompletion,
    BridgeDepositProcessingStatus.WaitingForEthFinality,
    BridgeDepositProcessingStatus.WaitingForPreviousJobCompletion,
];
type CanMintStatus = (typeof canMintStatus)[number];
export function canMint$(
    depositProcessingStatus$: ReturnType<typeof getDepositProcessingStatus$>
) {
    return depositProcessingStatus$.pipe(
        distinctUntilChanged(
            (prev, curr) =>
                prev.deposit_processing_status ===
                curr.deposit_processing_status
        ),
        map(({ deposit_processing_status }) => {
            if (
                deposit_processing_status ===
                BridgeDepositProcessingStatus.MissedMintingOpportunity
            ) {
                return BridgeDepositProcessingStatus.MissedMintingOpportunity;
            } else if (
                deposit_processing_status ===
                BridgeDepositProcessingStatus.ReadyToMint
            ) {
                return BridgeDepositProcessingStatus.ReadyToMint;
            } else if (
                canMintWaitingStatuses.includes(deposit_processing_status)
            ) {
                return 'Waiting';
            } else {
                // Suppress statuses not in any category by returning undefined
                return undefined;
            }
        }),
        // Filter out undefined values
        filter((status): status is CanMintStatus => status !== undefined),
        // Suppress duplicate consecutive mapped statuses
        distinctUntilChanged()
    );
}

// OLD VERSION
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
/*export function readyToComputeMintProof(
    depositProcessingStatus$: ReturnType<typeof getDepositProcessingStatus$>
) {
    return firstValueFrom(
        depositProcessingStatus$.pipe(
            // Error if we have missed our minting opportunity
            tap(({ deposit_processing_status, last_finalized_job }) => {
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
}*/

/**
 * Waits until the deposit is eligible for mint proof generation, based on bridge state.
 *
 * Specifically, resolves when:
 * - Deposit status is `ReadyToMint`, or
 * - Deposit status is `WaitingForCurrentJobCompletion` and the current stage is at or beyond `ProofConversionJobSucceeded`, or
 * - Deposit is in the last deposit window (between last finalized job input and output blocks),
 *   the current job has not finalized (`EthProcessorTransactionFinalizationSucceeded`), and
 *   the current job is not the same as the last finalized job (to handle an edge case where last finalized job updates at finalization event).
 *
 * Emits a warning if the deposit is in the last window and the stage is advanced past `ProofConversionJobReceived`.
 *
 * Throws an error if the deposit processing status becomes `MissedMintingOpportunity`.
 *
 * @param depositProcessingStatus$ Observable emitting deposit processing updates.
 * @returns A promise resolving to true when mint proof generation is ready.
 * @throws Error if the minting opportunity is missed.
 */
export function readyToComputeMintProof(
    depositProcessingStatus$: ReturnType<typeof getDepositProcessingStatus$>
) {
    // FIXME we could probably simplify this!
    // If our status is ReadyToMint then we are good (but possibly warn)
    // If our status is WaitingForCurrentJobCompletion and > stageIndex(TransitionNoticeMessageType.ProofConversionJobReceived)
    return firstValueFrom(
        depositProcessingStatus$.pipe(
            // Extend emitted values with computed properties for clarity and reuse
            map((data) => {
                const {
                    last_finalized_job,
                    deposit_block_number,
                    input_block_number,
                    output_block_number,
                } = data;

                // Determine if last finalized job is known (not 'unknown')
                const last_finalized_known = last_finalized_job !== 'unknown';

                // Check if deposit is in the last deposit window
                const deposit_is_in_last_window =
                    last_finalized_known &&
                    last_finalized_job.input_block_number <=
                        deposit_block_number &&
                    deposit_block_number <=
                        last_finalized_job.output_block_number;

                // Edge case: current job’s block range equals the last finalized job’s range.
                // This happens specifically at the `EthProcessorTransactionFinalizationSucceeded` event,
                // when the last finalized job info is updated with the current job's values,
                // causing both last finalized and current job block ranges to be identical.
                const current_job_equals_last_finalized =
                    last_finalized_known &&
                    last_finalized_job.input_block_number ===
                        input_block_number &&
                    last_finalized_job.output_block_number ===
                        output_block_number;

                return {
                    ...data,
                    last_finalized_known,
                    deposit_is_in_last_window,
                    current_job_equals_last_finalized,
                };
            }),
            tap(
                ({
                    deposit_processing_status,
                    stage_name,
                    deposit_is_in_last_window,
                    current_job_equals_last_finalized,
                }) => {
                    // Throw if minting opportunity is missed
                    if (
                        deposit_processing_status ===
                        BridgeDepositProcessingStatus.MissedMintingOpportunity
                    ) {
                        throw new Error('Minting opportunity missed.');
                    }

                    // Warn if deposit is in the last window and the stage is advanced past ProofConversionJobReceived,
                    // excluding the edge case where the current job’s block range equals the last finalized job’s block range.
                    // This needs checking.
                    if (
                        deposit_processing_status !=
                            BridgeDepositProcessingStatus.ReadyToMint &&
                        deposit_is_in_last_window &&
                        stageIndex(stage_name) >
                            stageIndexProofConversionJobSucceeded &&
                        !current_job_equals_last_finalized
                    ) {
                        console.warn(
                            'Warning: Deposit is in the last window and stage is advanced beyond ProofConversionJobReceived. Your cutting it close to snipe the window.'
                        );
                    }
                }
            ),
            filter(
                ({
                    deposit_processing_status,
                    stage_name,
                    deposit_is_in_last_window,
                    current_job_equals_last_finalized,
                }) => {
                    // Accept if ReadyToMint
                    if (
                        deposit_processing_status ===
                        BridgeDepositProcessingStatus.ReadyToMint
                    )
                        return true;

                    const stageIdx = stageIndex(stage_name);

                    // Accept if deposit status is WaitingForCurrentJobCompletion
                    // and stage is at or beyond ProofConversionJobSucceeded
                    const waitingForCurrentJobAndStageOk =
                        deposit_processing_status ===
                            BridgeDepositProcessingStatus.WaitingForCurrentJobCompletion &&
                        stageIdx >= stageIndexProofConversionJobSucceeded;

                    //
                    // Accept if deposit is in the last deposit window AND
                    // the current job stage is not finalized,
                    // excluding the edge case where current job equals last finalized job
                    const inLastWindowAndNotAtMinaFinalizedStage =
                        deposit_is_in_last_window &&
                        stageIdx <
                            stageIndexEthProcessorTransactionSubmitSucceeded &&
                        //stage_name !==
                        //    TransitionNoticeMessageType.EthProcessorTransactionFinalizationSucceeded && // This may be too late!
                        !current_job_equals_last_finalized; // Redundant be helped me rationalise it

                    return (
                        waitingForCurrentJobAndStageOk ||
                        inLastWindowAndNotAtMinaFinalizedStage
                    );
                }
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
