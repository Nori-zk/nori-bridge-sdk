import { filter } from 'rxjs';
import type { PublicKey } from 'o1js';
import {
    createDepositStateSnapshotTransition$,
} from '../getDepositStateSnapshot.js';
import { DepositState } from '../types.js';
import { DepositStateGraph, type DepositStateNodeUnion } from './deposit.js';

export function createDepositStateMachine(
    bridgeAddress: PublicKey,
    depositTxHash: string,
    proofQueueAddress: string,
    archiveUrl: string,
    bridgeTimeHeuristicMs?: number,
    initial: DepositStateNodeUnion = { node: 'undetermined', data: {} },
    pollIntervalMs = 15_000
) {
    const checkDepositState$ = createDepositStateSnapshotTransition$(
        bridgeAddress,
        depositTxHash,
        proofQueueAddress,
        archiveUrl,
        bridgeTimeHeuristicMs,
        initial,
        pollIntervalMs
    );

    return DepositStateGraph.implement({
        checkWhetherDepositIsUnprocessed: {
            $: () =>
                checkDepositState$().pipe(
                    filter(
                        (
                            snapshot
                        ): snapshot is (typeof DepositStateGraph.nodes)['unprocessed'] =>
                            snapshot.state === DepositState.Unprocessed
                    )
                ),
            next: (snapshot) => snapshot,
        },
        checkWhetherDepositIsReadyToMint: {
            $: () =>
                checkDepositState$().pipe(
                    filter(
                        (
                            snapshot
                        ): snapshot is (typeof DepositStateGraph.nodes)['readyToMint'] =>
                            snapshot.state === DepositState.ReadyToMint
                    )
                ),
            next: (snapshot) => snapshot,
        },
        checkWhetherMintingOpportunityWasMissed: {
            $: () =>
                checkDepositState$().pipe(
                    filter(
                        (
                            snapshot
                        ): snapshot is (typeof DepositStateGraph.nodes)['missedMintingOpportunity'] =>
                            snapshot.state ===
                            DepositState.MissedMintingOpportunity
                    )
                ),
            next: (snapshot) => snapshot,
        },
        checkWhetherUnprocessedDepositIsReadyToMint: {
            $: () =>
                checkDepositState$().pipe(
                    filter(
                        (
                            snapshot
                        ): snapshot is (typeof DepositStateGraph.nodes)['readyToMint'] =>
                            snapshot.state === DepositState.ReadyToMint
                    )
                ),
            next: (snapshot) => snapshot,
        },
        checkWhetherMintingOpportunityHasExpired: {
            $: () =>
                checkDepositState$().pipe(
                    filter(
                        (
                            snapshot
                        ): snapshot is (typeof DepositStateGraph.nodes)['missedMintingOpportunity'] =>
                            snapshot.state ===
                            DepositState.MissedMintingOpportunity
                    )
                ),
            next: (snapshot) => snapshot,
        },
    });
}
