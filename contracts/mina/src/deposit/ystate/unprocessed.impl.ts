import {
    combineLatest,
    distinctUntilChanged,
    filter,
    interval,
    map,
    type ObservedValueOf,
    shareReplay,
} from 'rxjs';
import { TransitionNoticeMessageType } from '@nori-zk/pts-types';
import { BridgeDepositProcessingStatus } from '../../rx/deposit.js';
import {
    UnprocessedDepositStateGraph,
    type UnprocessedDepositTopics,
} from './unprocessed.js';

type EthState = ObservedValueOf<UnprocessedDepositTopics['ethStateTopic$']>;
type BridgeState = ObservedValueOf<UnprocessedDepositTopics['bridgeStateTopic$']>;
type BridgeTimings = ObservedValueOf<UnprocessedDepositTopics['bridgeTimingsTopic$']>;
type UnprocessedDepositProcessingStatus =
    | BridgeDepositProcessingStatus.WaitingForEthFinality
    | BridgeDepositProcessingStatus.WaitingForPreviousJobCompletion
    | BridgeDepositProcessingStatus.WaitingForCurrentJobCompletion;
type DepositScopedBridgeObservation = {
    deposit_processing_status: UnprocessedDepositProcessingStatus | undefined;
    ethState: EthState;
    bridgeState: BridgeState;
    bridgeTimings: BridgeTimings;
};
type DepositScopedBridgeObservation$ = ReturnType<
    typeof createDepositScopedBridgeObservation$
>;
type UnprocessedDepositMachineScope = {
    depositBlockNumber: number;
    depositScopedBridgeObservation$: DepositScopedBridgeObservation$;
};

function getUnprocessedDepositProcessingStatus(
    depositBlockNumber: number,
    ethState: EthState,
    bridgeState: BridgeState
): UnprocessedDepositProcessingStatus | undefined {
    if (ethState.latest_finality_block_number < depositBlockNumber) {
        return BridgeDepositProcessingStatus.WaitingForEthFinality;
    }

    if (
        bridgeState.input_block_number <= depositBlockNumber &&
        depositBlockNumber <= bridgeState.output_block_number
    ) {
        if (
            bridgeState.stage_name ===
            TransitionNoticeMessageType.EthProcessorTransactionFinalizationSucceeded
        ) {
            return undefined;
        }

        return BridgeDepositProcessingStatus.WaitingForCurrentJobCompletion;
    }

    if (bridgeState.output_block_number < depositBlockNumber) {
        return BridgeDepositProcessingStatus.WaitingForPreviousJobCompletion;
    }

    return undefined;
}

function getEthFinalityTimeRemaining(
    depositBlockNumber: number,
    ethState: EthState
) {
    const delta =
        ethState.latest_finality_slot - ethState.latest_finality_block_number;
    const depositSlot = depositBlockNumber + delta;
    const rounded = Math.ceil(depositSlot / 32) * 32;
    const blocksRemaining =
        rounded - delta - ethState.latest_finality_block_number;

    return Math.max(0, blocksRemaining * 12) + 1;
}

function getBridgeTimeRemaining(
    bridgeState: BridgeState,
    bridgeTimings: BridgeTimings
) {
    return (
        (bridgeTimings.extension[bridgeState.stage_name] ?? 15) -
        bridgeState.elapsed_sec +
        1
    );
}

function getTimeRemaining(
    depositBlockNumber: number,
    status: UnprocessedDepositProcessingStatus,
    ethState: EthState,
    bridgeState: BridgeState,
    bridgeTimings: BridgeTimings
) {
    if (status === BridgeDepositProcessingStatus.WaitingForEthFinality) {
        return getEthFinalityTimeRemaining(depositBlockNumber, ethState);
    }

    return getBridgeTimeRemaining(bridgeState, bridgeTimings);
}

function getElapsed(
    status: UnprocessedDepositProcessingStatus,
    bridgeState: BridgeState
) {
    if (status === BridgeDepositProcessingStatus.WaitingForEthFinality) {
        return 0;
    }

    return bridgeState.elapsed_sec;
}

function isWaitingForPreviousProofRequestCompletion(
    depositBlockNumber: number,
    bridgeState: BridgeState
) {
    return bridgeState.output_block_number < depositBlockNumber;
}

function isWaitingForCurrentProofRequestCompletion(
    depositBlockNumber: number,
    bridgeState: BridgeState
) {
    return (
        bridgeState.input_block_number <= depositBlockNumber &&
        depositBlockNumber <= bridgeState.output_block_number &&
        bridgeState.stage_name !==
            TransitionNoticeMessageType.EthProcessorTransactionFinalizationSucceeded
    );
}

function hasFinishedWaitingForProofRequest(
    depositBlockNumber: number,
    ethState: EthState,
    bridgeState: BridgeState
) {
    if (ethState.latest_finality_block_number < depositBlockNumber) {
        return false;
    }

    if (depositBlockNumber < bridgeState.input_block_number) {
        return true;
    }

    return (
        bridgeState.input_block_number <= depositBlockNumber &&
        depositBlockNumber <= bridgeState.output_block_number &&
        bridgeState.stage_name ===
            TransitionNoticeMessageType.EthProcessorTransactionFinalizationSucceeded
    );
}

function toWaitingNodeData(
    depositBlockNumber: number,
    {
        deposit_processing_status,
        ethState,
        bridgeState,
        bridgeTimings,
    }: DepositScopedBridgeObservation & {
        deposit_processing_status: UnprocessedDepositProcessingStatus;
    }
) {
    return {
        ...bridgeState,
        time_remaining_sec: getTimeRemaining(
            depositBlockNumber,
            deposit_processing_status,
            ethState,
            bridgeState,
            bridgeTimings
        ),
        elapsed_sec: getElapsed(deposit_processing_status, bridgeState),
        deposit_processing_status,
        deposit_block_number: depositBlockNumber,
    };
}

function tickWaitingNodeData<
    T extends {
        time_remaining_sec: number;
        elapsed_sec: number;
    },
>(source: T): T {
    return {
        ...source,
        time_remaining_sec: source.time_remaining_sec - 1,
        elapsed_sec: source.elapsed_sec + 1,
    };
}

function createDepositScopedBridgeObservation$(
    depositBlockNumber: number,
    {
        ethStateTopic$,
        bridgeStateTopic$,
        bridgeTimingsTopic$,
    }: UnprocessedDepositTopics
) {
    return combineLatest([
        ethStateTopic$,
        bridgeStateTopic$,
        bridgeTimingsTopic$,
    ]).pipe(
        distinctUntilChanged(
            ([previousEth, previousBridge, previousTimings], [
                currentEth,
                currentBridge,
                currentTimings,
            ]) =>
                JSON.stringify(previousEth) === JSON.stringify(currentEth) &&
                JSON.stringify(previousBridge) ===
                    JSON.stringify(currentBridge) &&
                JSON.stringify(previousTimings) ===
                    JSON.stringify(currentTimings)
        ),
        map(
            ([ethState, bridgeState, bridgeTimings]): DepositScopedBridgeObservation => ({
                deposit_processing_status: getUnprocessedDepositProcessingStatus(
                    depositBlockNumber,
                    ethState,
                    bridgeState
                ),
                ethState,
                bridgeState,
                bridgeTimings,
            })
        ),
        shareReplay(1)
    );
}

function checkWhetherWaitingForPreviousJobCompletion$(
    {
        depositBlockNumber,
        depositScopedBridgeObservation$,
    }: UnprocessedDepositMachineScope
) {
    return depositScopedBridgeObservation$.pipe(
        filter(
            (
                update
            ): update is DepositScopedBridgeObservation & {
                deposit_processing_status: BridgeDepositProcessingStatus.WaitingForPreviousJobCompletion;
            } =>
                update.deposit_processing_status ===
                    BridgeDepositProcessingStatus.WaitingForPreviousJobCompletion &&
                isWaitingForPreviousProofRequestCompletion(
                    depositBlockNumber,
                    update.bridgeState
                )
        )
    );
}

function checkWhetherWaitingForCurrentJobCompletion$(
    {
        depositBlockNumber,
        depositScopedBridgeObservation$,
    }: UnprocessedDepositMachineScope
) {
    return depositScopedBridgeObservation$.pipe(
        filter(
            (
                update
            ): update is DepositScopedBridgeObservation & {
                deposit_processing_status: BridgeDepositProcessingStatus.WaitingForCurrentJobCompletion;
            } =>
                update.deposit_processing_status ===
                    BridgeDepositProcessingStatus.WaitingForCurrentJobCompletion &&
                isWaitingForCurrentProofRequestCompletion(
                    depositBlockNumber,
                    update.bridgeState
                )
        )
    );
}

function checkWhetherFinishedWaiting$(
    {
        depositBlockNumber,
        depositScopedBridgeObservation$,
    }: UnprocessedDepositMachineScope
) {
    return depositScopedBridgeObservation$.pipe(
        filter((update) =>
            hasFinishedWaitingForProofRequest(
                depositBlockNumber,
                update.ethState,
                update.bridgeState
            )
        )
    );
}

function tickWaitingForEthFinality$() {
    return interval(1000);
}

function tickWaitingForPreviousJobCompletion$() {
    return interval(1000);
}

function tickWaitingForCurrentJobCompletion$() {
    return interval(1000);
}

export function createUnprocessedDepositStateMachine(
    depositBlockNumber: number,
    topics: UnprocessedDepositTopics
) {
    const scope: UnprocessedDepositMachineScope = {
        depositBlockNumber,
        depositScopedBridgeObservation$: createDepositScopedBridgeObservation$(
            depositBlockNumber,
            topics
        ),
    };

    return UnprocessedDepositStateGraph.implement({
        tickWaitingForEthFinality: {
            $: tickWaitingForEthFinality$,
            next: (_tick, _dest, source) => tickWaitingNodeData(source),
        },
        checkWhetherWaitingForPreviousJobCompletion: {
            $: () => checkWhetherWaitingForPreviousJobCompletion$(scope),
            next: (update) => toWaitingNodeData(depositBlockNumber, update),
        },
        checkWhetherWaitingForCurrentJobCompletion: {
            $: () => checkWhetherWaitingForCurrentJobCompletion$(scope),
            next: (update) => toWaitingNodeData(depositBlockNumber, update),
        },
        checkWhetherFinishedWaiting: {
            $: () => checkWhetherFinishedWaiting$(scope),
            next: () => ({}),
        },
        tickWaitingForPreviousJobCompletion: {
            $: tickWaitingForPreviousJobCompletion$,
            next: (_tick, _dest, source) => tickWaitingNodeData(source),
        },
        tickWaitingForCurrentJobCompletion: {
            $: tickWaitingForCurrentJobCompletion$,
            next: (_tick, _dest, source) => tickWaitingNodeData(source),
        },
    });
}
