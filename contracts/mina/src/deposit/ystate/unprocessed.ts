import { define } from '@yaw-rx/ystate';
import type { ObservedValueOf } from 'rxjs';
import type {
    getBridgeStateTopic$,
    getBridgeTimingsTopic$,
    getEthStateTopic$,
} from '../../rx/topics.js';
import { BridgeDepositProcessingStatus } from '../../rx/deposit.js';

type BridgeState = ObservedValueOf<ReturnType<typeof getBridgeStateTopic$>>;

export type UnprocessedDepositStateData = BridgeState & {
    time_remaining_sec: number;
    deposit_processing_status: BridgeDepositProcessingStatus;
    deposit_block_number: number;
};

export const UnprocessedDepositStateGraph = define({
    nodes: {
        WaitingForEthFinality: {} as UnprocessedDepositStateData & {
            deposit_processing_status: BridgeDepositProcessingStatus.WaitingForEthFinality;
        },
        WaitingForPreviousJobCompletion: {} as UnprocessedDepositStateData & {
            deposit_processing_status: BridgeDepositProcessingStatus.WaitingForPreviousJobCompletion;
        },
        WaitingForCurrentJobCompletion: {} as UnprocessedDepositStateData & {
            deposit_processing_status: BridgeDepositProcessingStatus.WaitingForCurrentJobCompletion;
        },
        FinishedWaiting: {},
    },
    edges: {
        ethFinalityPending: {
            from: 'WaitingForEthFinality',
            to: 'WaitingForEthFinality',
            on: 'tickWaitingForEthFinality.next',
        },
        ethFinalityReached: {
            from: 'WaitingForEthFinality',
            to: 'WaitingForPreviousJobCompletion',
            on: 'checkWhetherWaitingForPreviousJobCompletion.next',
        },
        previousProofRequestsComplete: {
            from: 'WaitingForEthFinality',
            to: 'WaitingForCurrentJobCompletion',
            on: 'checkWhetherWaitingForCurrentJobCompletion.next',
        },
        proofRequestAlreadyComplete: {
            from: 'WaitingForEthFinality',
            to: 'FinishedWaiting',
            on: 'checkWhetherFinishedWaiting.next',
        },
        previousProofRequestsPending: {
            from: 'WaitingForPreviousJobCompletion',
            to: 'WaitingForPreviousJobCompletion',
            on: 'tickWaitingForPreviousJobCompletion.next',
        },
        previousProofRequestsCompleted: {
            from: 'WaitingForPreviousJobCompletion',
            to: 'WaitingForCurrentJobCompletion',
            on: 'checkWhetherWaitingForCurrentJobCompletion.next',
        },
        proofRequestCompletedAfterPrevious: {
            from: 'WaitingForPreviousJobCompletion',
            to: 'FinishedWaiting',
            on: 'checkWhetherFinishedWaiting.next',
        },
        currentProofRequestPending: {
            from: 'WaitingForCurrentJobCompletion',
            to: 'WaitingForCurrentJobCompletion',
            on: 'tickWaitingForCurrentJobCompletion.next',
        },
        currentProofRequestCompleted: {
            from: 'WaitingForCurrentJobCompletion',
            to: 'FinishedWaiting',
            on: 'checkWhetherFinishedWaiting.next',
        },
    },
});

export type UnprocessedDepositStateNodeUnion = {
    [Node in keyof typeof UnprocessedDepositStateGraph.nodes]: {
        node: Node;
        data: (typeof UnprocessedDepositStateGraph.nodes)[Node];
    };
}[keyof typeof UnprocessedDepositStateGraph.nodes];

export type UnprocessedDepositTopics = {
    ethStateTopic$: ReturnType<typeof getEthStateTopic$>;
    bridgeStateTopic$: ReturnType<typeof getBridgeStateTopic$>;
    bridgeTimingsTopic$: ReturnType<typeof getBridgeTimingsTopic$>;
};
