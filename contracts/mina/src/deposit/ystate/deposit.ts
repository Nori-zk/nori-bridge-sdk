import { define } from '@yaw-rx/ystate';
import type { Field } from 'o1js';
import { DepositState } from '../types.js';

export const DepositStateGraph = define({
    nodes: {
        undetermined: {},
        unprocessed: {
            state: DepositState.Unprocessed as typeof DepositState.Unprocessed,
            depositRequestId: 0n as bigint,
            depositBlockNumber: 0n as bigint,
            queueCursor: 0n as bigint,
            latestOutputBlockNumber: 0n as bigint,
            currentMinaHeight: 0,
            windowStart: undefined as unknown as Field,
            windowSize: undefined as unknown as Field,
        },
        readyToMint: {
            state: DepositState.ReadyToMint as typeof DepositState.ReadyToMint,
            depositRequestId: 0n as bigint,
            depositBlockNumber: 0n as bigint,
            queueCursor: 0n as bigint,
            root: undefined as unknown as Field,
            inputQueueCursor: 0n as bigint,
            outputQueueCursor: 0n as bigint,
            outputBlockNumber: 0n as bigint,
            remainingUpdates: 0,
            minaBlockNumber: 0,
            indexInBatch: 0n as bigint,
            currentMinaHeight: 0,
            windowStart: undefined as unknown as Field,
            windowSize: undefined as unknown as Field,
            actionStateHash: undefined as unknown as Field,
        },
        missedMintingOpportunity: {
            state: DepositState.MissedMintingOpportunity as typeof DepositState.MissedMintingOpportunity,
            depositRequestId: 0n as bigint,
            depositBlockNumber: 0n as bigint,
            queueCursor: 0n as bigint,
            root: undefined as unknown as Field,
            inputQueueCursor: 0n as bigint,
            outputQueueCursor: 0n as bigint,
            outputBlockNumber: 0n as bigint,
            minaBlockNumber: 0,
            currentMinaHeight: 0,
            windowStart: undefined as unknown as Field,
            windowSize: undefined as unknown as Field,
            actionStateHash: undefined as unknown as Field,
        },
    },
    edges: {
        discoveredUnprocessed: {
            from: 'undetermined',
            to: 'unprocessed',
            on: 'checkWhetherDepositIsUnprocessed.next',
        },
        discoveredReadyToMint: {
            from: 'undetermined',
            to: 'readyToMint',
            on: 'checkWhetherDepositIsReadyToMint.next',
        },
        discoveredMissedMintingOpportunity: {
            from: 'undetermined',
            to: 'missedMintingOpportunity',
            on: 'checkWhetherMintingOpportunityWasMissed.next',
        },
        proofRequestCommitted: {
            from: 'unprocessed',
            to: 'readyToMint',
            on: 'checkWhetherUnprocessedDepositIsReadyToMint.next',
        },
        mintingWindowExpired: {
            from: 'readyToMint',
            to: 'missedMintingOpportunity',
            on: 'checkWhetherMintingOpportunityHasExpired.next',
        },
    },
});

export type DepositStateNodeUnion = {
    [Node in keyof typeof DepositStateGraph.nodes]: {
        node: Node;
        data: (typeof DepositStateGraph.nodes)[Node];
    };
}[keyof typeof DepositStateGraph.nodes];
