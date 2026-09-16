import { filter } from 'rxjs';
import type { PublicKey } from 'o1js';
import { type EthereumProvider } from '@nori-zk/ethers-iso-provider';
import {
    createDepositStateSnapshotTransition$,
} from '../getDepositStateSnapshot.js';
import type { MinaRpc } from '../rpc/mina/index.js';
import { DepositState } from '../types.js';
import { DepositStateGraph, type DepositStateNodeUnion } from './deposit.js';

/**
 * Creates the deposit state machine for one Ethereum deposit.
 *
 * @param bridgeAddress The Mina token bridge address.
 * @param depositTxHash The Ethereum transaction hash containing the deposit.
 * @param proofQueueAddress The Ethereum proof request queue address.
 * @param minaRpcProvider The Mina RPC/archive client used for all Mina reads.
 * @param provider The Ethereum provider shared by every machine transition.
 * @param bridgeTimeHeuristicMs The estimated interval between bridge updates.
 * @param initial The node from which the machine begins.
 * @param pollIntervalMs The delay between unchanged state checks in milliseconds.
 * @returns An implemented YState machine for the deposit lifecycle.
 */
export function createDepositStateMachine(
    bridgeAddress: PublicKey,
    depositTxHash: string,
    proofQueueAddress: string,
    minaRpcProvider: MinaRpc,
    provider: EthereumProvider,
    bridgeTimeHeuristicMs?: number,
    initial: DepositStateNodeUnion = { node: 'undetermined', data: {} },
    pollIntervalMs = 15_000
) {
    const checkDepositState$ = createDepositStateSnapshotTransition$(
        bridgeAddress,
        depositTxHash,
        proofQueueAddress,
        minaRpcProvider,
        provider,
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
