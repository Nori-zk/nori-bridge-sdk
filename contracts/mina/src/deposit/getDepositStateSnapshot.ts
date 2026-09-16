import { Field, UInt64, type PublicKey } from 'o1js';
import { Observable } from 'rxjs';
import { type EthereumProvider } from '@nori-zk/ethers-iso-provider';
import { depositAge as depositAgeEth } from './rpc/eth/depositAge.js';
import { findRequestIdByTxHash } from './rpc/eth/fetchProofRequest.js';
import { MinaRpc } from './rpc/mina/index.js';
import { singleActionInnerHash, advanceActionState } from '../NoriTokenBridge.js';
import { DepositState } from './types.js';
import {
    DepositStateGraph,
    type DepositStateNodeUnion,
} from './ystate/deposit.js';

const MINA_SLOT_DURATION_MS = 3_000;
const MAX_BATCH_SIZE = 2 ** 16;

export interface CommittedProofRequests {
    root: Field;
    outputBlockNumber: UInt64;
    inputQueueCursor: UInt64;
    outputQueueCursor: UInt64;
    actionStateHash: string;
    previousActionStateHash: string;
}

function decodeJob(
    actionState: { actionStateOne: string; actionStateTwo: string },
    actionData: { data: string[] }[]
): CommittedProofRequests {
    if (actionData.length !== 1) {
        throw new Error(
            `Expected exactly one settlement action per block, found ${actionData.length}.`
        );
    }
    const [rootStr, outputBlockNumberStr, inputQueueCursorStr, outputQueueCursorStr] =
        actionData[0].data;
    const fields = actionData[0].data.map((value) => Field(value));
    const derivedActionState = advanceActionState(
        Field(actionState.actionStateTwo),
        singleActionInnerHash(fields)
    );
    if (!derivedActionState.equals(Field(actionState.actionStateOne)).toBoolean()) {
        throw new Error(
            `Derived action state does not match archive-reported action state (expected ${actionState.actionStateOne}, derived ${derivedActionState.toString()}).`
        );
    }
    return {
        root: Field(rootStr),
        outputBlockNumber: UInt64.from(BigInt(outputBlockNumberStr)),
        inputQueueCursor: UInt64.from(BigInt(inputQueueCursorStr)),
        outputQueueCursor: UInt64.from(BigInt(outputQueueCursorStr)),
        actionStateHash: actionState.actionStateOne,
        previousActionStateHash: actionState.actionStateTwo,
    };
}

async function decodeJobsInRange(
    minaRpcProvider: MinaRpc,
    bridgeAddress: PublicKey,
    fromHeight: number,
    toHeight: number
): Promise<CommittedProofRequests[]> {
    const { actions } = await minaRpcProvider.fetchCommittedProofRequestsByBlockRange(
        bridgeAddress,
        fromHeight,
        toHeight
    );
    return actions.map(({ actionState, actionData }) => decodeJob(actionState, actionData));
}

interface DepositStateSnapshotRequest {
    bridgeAddress: PublicKey;
    depositTxHash: string;
    proofQueueAddress: string;
    minaRpcProvider: MinaRpc;
    bridgeTimeHeuristicMs?: number;
    provider: EthereumProvider;
}

interface CurrentBridgeWindow {
    queueCursor: bigint;
    latestOutputBlockNumber: bigint;
    currentMinaHeight: number;
    windowStart: Field;
    windowSize: Field;
    tipJob: CommittedProofRequests;
}

async function getCurrentBridgeWindow(
    minaRpcProvider: MinaRpc,
    bridgeAddress: PublicKey
): Promise<CurrentBridgeWindow> {
    const latestState = await minaRpcProvider.getLatestActionState(bridgeAddress);
    const queueCursor = latestState.queueCursor.toBigInt();
    const windowStart = latestState.windowStart;
    const windowSize = latestState.windowSize;

    const { bestChain } = await minaRpcProvider.fetchLatestBlock();
    const latestBlock = bestChain[0];
    if (!latestBlock) {
        throw new Error('No best chain block returned by the Mina node');
    }
    const currentMinaHeight = Number(
        latestBlock.protocolState.consensusState.blockHeight
    );
    const tipActions = await decodeJobsInRange(
        minaRpcProvider,
        bridgeAddress,
        currentMinaHeight,
        currentMinaHeight
    );
    const tipJob = tipActions[0];
    if (!tipJob) throw new Error('No settled jobs found on the bridge');
    const latestOutputBlockNumber = tipJob.outputBlockNumber.toBigInt();

    return {
        queueCursor,
        latestOutputBlockNumber,
        currentMinaHeight,
        windowStart,
        windowSize,
        tipJob,
    };
}

function findCommittedProofRequestPositionInDepositActionWindow(
    windowActions: { actionData: { data: string[] }[] }[],
    committedProofRequest: {
        root: Field;
        outputBlockNumber: bigint;
        inputQueueCursor: bigint;
        outputQueueCursor: bigint;
    }
) {
    for (let i = 0; i < windowActions.length; i++) {
        const actionData = windowActions[i].actionData;
        if (!actionData || actionData.length !== 1) continue;
        const [
            rootStr,
            outputBlockNumberStr,
            inputQueueCursorStr,
            outputQueueCursorStr,
        ] = actionData[0].data;
        const root = Field(rootStr);
        const outputBlockNumberField = UInt64.from(BigInt(outputBlockNumberStr));
        const inputQueueCursorField = UInt64.from(BigInt(inputQueueCursorStr));
        const outputQueueCursorField = UInt64.from(BigInt(outputQueueCursorStr));
        if (
            root.equals(committedProofRequest.root) &&
            outputBlockNumberField.equals(
                UInt64.from(committedProofRequest.outputBlockNumber)
            ) &&
            inputQueueCursorField.equals(
                UInt64.from(committedProofRequest.inputQueueCursor)
            ) &&
            outputQueueCursorField.equals(
                UInt64.from(committedProofRequest.outputQueueCursor)
            )
        ) {
            return i;
        }
    }
    return -1;
}

async function findPreviousJob(
    minaRpcProvider: MinaRpc,
    bridgeAddress: PublicKey,
    previousActionStateHash: string
): Promise<CommittedProofRequests> {
    const { actions } = await minaRpcProvider.fetchWindowActions(
        bridgeAddress,
        Field(previousActionStateHash)
    );
    const { actionState, actionData } = actions[0] ?? {};
    if (!actionState || actionState.actionStateOne !== previousActionStateHash) {
        throw new Error(`No settlement job found for action state ${previousActionStateHash}`);
    }
    return decodeJob(actionState, actionData);
}

async function classifyProcessedDeposit(
    request: DepositStateSnapshotRequest,
    depositRequestId: bigint,
    depositBlockNumber: bigint,
    currentWindow: CurrentBridgeWindow
): Promise<
    (typeof DepositStateGraph.nodes)[
        | 'unprocessed'
        | 'readyToMint'
        | 'missedMintingOpportunity'
    ]
> {
    const {
        queueCursor,
        windowStart,
        windowSize,
        currentMinaHeight,
        tipJob,
    } = currentWindow;

    const avgInterval = request.bridgeTimeHeuristicMs ?? 15 * 60 * 1000;
    const depositAgeMs = await depositAgeEth(
        depositBlockNumber,
        request.provider
    );
    const estimatedUpdates = Math.round(depositAgeMs / avgInterval);
    const requestsBehind = queueCursor - depositRequestId;
    const estimatedByRequests = Math.floor(
        Number(requestsBehind) / MAX_BATCH_SIZE
    );
    const estimatedJobs = Math.max(estimatedUpdates, estimatedByRequests);
    const estimatedBlocksBack = Math.max(
        1,
        Math.round(estimatedJobs * (avgInterval / MINA_SLOT_DURATION_MS))
    );
    let low = Math.max(1, currentMinaHeight - estimatedBlocksBack);
    let high = currentMinaHeight;

    if (tipJob.outputQueueCursor.toBigInt() <= depositRequestId) {
        throw new Error('Tip job does not cover the deposit (inconsistent state)');
    }

    let aboveJob = tipJob;
    let aboveBlock = currentMinaHeight;

    let gap = estimatedBlocksBack;
    while (low > 1) {
        const actions = await decodeJobsInRange(
            request.minaRpcProvider,
            request.bridgeAddress,
            low,
            low
        );
        const act = actions[0];
        if (!act || act.outputQueueCursor.toBigInt() <= depositRequestId) {
            break;
        } else {
            aboveJob = act;
            aboveBlock = low;
            high = low;
            low = Math.max(1, low - Math.floor(gap / 2));
            gap = Math.floor(gap / 2);
            if (gap === 0) break;
        }
    }

    let lo = low;
    let hi = high;
    while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        const midActions = await decodeJobsInRange(
            request.minaRpcProvider,
            request.bridgeAddress,
            mid,
            mid
        );
        const midAct = midActions[0];
        if (!midAct || midAct.outputQueueCursor.toBigInt() <= depositRequestId) {
            lo = mid;
        } else {
            hi = mid;
            aboveJob = midAct;
            aboveBlock = mid;
        }
    }

    const inputCursor = aboveJob.inputQueueCursor.toBigInt();
    const outputCursor = aboveJob.outputQueueCursor.toBigInt();
    if (depositRequestId < inputCursor || depositRequestId >= outputCursor) {
        throw new Error(
            `Deposit request ${depositRequestId} not covered by found job (${inputCursor} - ${outputCursor})`
        );
    }
    const indexInBatch = depositRequestId - inputCursor;
    const outputBlockNumber = aboveJob.outputBlockNumber.toBigInt();

    const { actions: windowActions } = await request.minaRpcProvider.fetchWindowActions(
        request.bridgeAddress,
        windowStart
    );

    const position = findCommittedProofRequestPositionInDepositActionWindow(windowActions, {
        root: aboveJob.root,
        outputBlockNumber,
        inputQueueCursor: inputCursor,
        outputQueueCursor: outputCursor,
    });

    if (position === -1) {
        return {
            state: DepositState.MissedMintingOpportunity,
            depositRequestId,
            depositBlockNumber,
            queueCursor,
            root: aboveJob.root,
            inputQueueCursor: inputCursor,
            outputQueueCursor: outputCursor,
            outputBlockNumber,
            minaBlockNumber: aboveBlock,
            currentMinaHeight,
            windowStart,
            windowSize,
            actionStateHash: Field(aboveJob.actionStateHash),
        };
    }

    const remainingUpdates = Number(windowSize.toBigInt() - BigInt(position) - 1n);
    const previousOutputBlockNumber =
        inputCursor === 0n
            ? -1n // sentinel: no previous settlement job (first-ever batch)
            : (
                  await findPreviousJob(
                      request.minaRpcProvider,
                      request.bridgeAddress,
                      aboveJob.previousActionStateHash
                  )
              ).outputBlockNumber.toBigInt();
    return {
        state: DepositState.ReadyToMint,
        depositRequestId,
        depositBlockNumber,
        queueCursor,
        root: aboveJob.root,
        inputQueueCursor: inputCursor,
        outputQueueCursor: outputCursor,
        outputBlockNumber,
        previousOutputBlockNumber,
        remainingUpdates,
        minaBlockNumber: aboveBlock,
        indexInBatch,
        currentMinaHeight,
        windowStart,
        windowSize,
        actionStateHash: Field(aboveJob.actionStateHash),
    };
}

async function recheckReadyToMintDepositStateSnapshot(
    request: DepositStateSnapshotRequest,
    previous: (typeof DepositStateGraph.nodes)['readyToMint']
): Promise<
    (typeof DepositStateGraph.nodes)[
        | 'unprocessed'
        | 'readyToMint'
        | 'missedMintingOpportunity'
    ]
> {
    const currentWindow = await getCurrentBridgeWindow(
        request.minaRpcProvider,
        request.bridgeAddress
    );
    const { actions: windowActions } = await request.minaRpcProvider.fetchWindowActions(
        request.bridgeAddress,
        currentWindow.windowStart
    );
    const position =
        findCommittedProofRequestPositionInDepositActionWindow(
            windowActions,
            previous
        );

    if (position === -1) {
        return {
            state: DepositState.MissedMintingOpportunity,
            depositRequestId: previous.depositRequestId,
            depositBlockNumber: previous.depositBlockNumber,
            queueCursor: currentWindow.queueCursor,
            root: previous.root,
            inputQueueCursor: previous.inputQueueCursor,
            outputQueueCursor: previous.outputQueueCursor,
            outputBlockNumber: previous.outputBlockNumber,
            minaBlockNumber: previous.minaBlockNumber,
            currentMinaHeight: currentWindow.currentMinaHeight,
            windowStart: currentWindow.windowStart,
            windowSize: currentWindow.windowSize,
            actionStateHash: previous.actionStateHash,
        };
    }

    return {
        ...previous,
        queueCursor: currentWindow.queueCursor,
        remainingUpdates: Number(
            currentWindow.windowSize.toBigInt() - BigInt(position) - 1n
        ),
        currentMinaHeight: currentWindow.currentMinaHeight,
        windowStart: currentWindow.windowStart,
        windowSize: currentWindow.windowSize,
    };
}

async function recheckUnprocessedDepositStateSnapshot(
    request: DepositStateSnapshotRequest,
    previous: (typeof DepositStateGraph.nodes)['unprocessed']
): Promise<
    (typeof DepositStateGraph.nodes)[
        | 'unprocessed'
        | 'readyToMint'
        | 'missedMintingOpportunity'
    ]
> {
    const currentWindow = await getCurrentBridgeWindow(
        request.minaRpcProvider,
        request.bridgeAddress
    );
    if (previous.depositRequestId >= currentWindow.queueCursor) {
        return {
            ...previous,
            queueCursor: currentWindow.queueCursor,
            latestOutputBlockNumber: currentWindow.latestOutputBlockNumber,
            currentMinaHeight: currentWindow.currentMinaHeight,
            windowStart: currentWindow.windowStart,
            windowSize: currentWindow.windowSize,
        };
    }

    return classifyProcessedDeposit(
        request,
        previous.depositRequestId,
        previous.depositBlockNumber,
        currentWindow
    );
}

/**
 * Discovers the current minting state of an Ethereum deposit.
 *
 * @param bridgeAddress The Mina token bridge address.
 * @param depositTxHash The Ethereum transaction hash containing the deposit.
 * @param proofQueueAddress The Ethereum proof request queue address.
 * @param minaRpcProvider The Mina RPC/archive client used for all Mina reads.
 * @param provider The Ethereum provider used for receipt and block reads.
 * @param bridgeTimeHeuristicMs The estimated interval between bridge updates.
 * @returns Data for the unprocessed, ready to mint, or missed deposit state.
 */
export async function getDepositStateSnapshot(
    bridgeAddress: PublicKey,
    depositTxHash: string,
    proofQueueAddress: string,
    minaRpcProvider: MinaRpc,
    provider: EthereumProvider,
    bridgeTimeHeuristicMs?: number
): Promise<
    (typeof DepositStateGraph.nodes)[
        | 'unprocessed'
        | 'readyToMint'
        | 'missedMintingOpportunity'
    ]
> {
    const requestData = await findRequestIdByTxHash(
        proofQueueAddress,
        depositTxHash,
        provider
    );
    const depositRequestId = requestData.requestId;
    const depositBlockNumber = BigInt(requestData.blockNumber);
    const request = {
        bridgeAddress,
        depositTxHash,
        proofQueueAddress,
        minaRpcProvider,
        bridgeTimeHeuristicMs,
        provider,
    };

    const currentWindow = await getCurrentBridgeWindow(minaRpcProvider, bridgeAddress);

    if (depositRequestId >= currentWindow.queueCursor) {
        return {
            state: DepositState.Unprocessed,
            depositRequestId,
            depositBlockNumber,
            queueCursor: currentWindow.queueCursor,
            latestOutputBlockNumber: currentWindow.latestOutputBlockNumber,
            currentMinaHeight: currentWindow.currentMinaHeight,
            windowStart: currentWindow.windowStart,
            windowSize: currentWindow.windowSize,
        };
    }

    return classifyProcessedDeposit(
        request,
        depositRequestId,
        depositBlockNumber,
        currentWindow
    );
}

/**
 * Refreshes a previously discovered deposit state using the same deposit data.
 *
 * @param current The current node and its state data.
 * @param bridgeAddress The Mina token bridge address.
 * @param depositTxHash The Ethereum transaction hash containing the deposit.
 * @param proofQueueAddress The Ethereum proof request queue address.
 * @param minaRpcProvider The Mina RPC/archive client used for all Mina reads.
 * @param provider The Ethereum provider used for any required Ethereum reads.
 * @param bridgeTimeHeuristicMs The estimated interval between bridge updates.
 * @returns The refreshed unprocessed, ready to mint, or missed state data.
 */
export async function recheckDepositStateSnapshot(
    current: DepositStateNodeUnion,
    bridgeAddress: PublicKey,
    depositTxHash: string,
    proofQueueAddress: string,
    minaRpcProvider: MinaRpc,
    provider: EthereumProvider,
    bridgeTimeHeuristicMs?: number
): Promise<
    (typeof DepositStateGraph.nodes)[
        | 'unprocessed'
        | 'readyToMint'
        | 'missedMintingOpportunity'
    ]
> {
    const request = {
        bridgeAddress,
        depositTxHash,
        proofQueueAddress,
        minaRpcProvider,
        bridgeTimeHeuristicMs,
        provider,
    };

    if (current.node === DepositState.Undetermined) {
        return getDepositStateSnapshot(
            bridgeAddress,
            depositTxHash,
            proofQueueAddress,
            minaRpcProvider,
            provider,
            bridgeTimeHeuristicMs
        );
    }

    if (current.node === DepositState.MissedMintingOpportunity) {
        return current.data;
    }

    if (current.node === DepositState.ReadyToMint) {
        return recheckReadyToMintDepositStateSnapshot(request, current.data);
    }

    return recheckUnprocessedDepositStateSnapshot(request, current.data);
}

function toDepositStateNode(
    snapshot: (typeof DepositStateGraph.nodes)[
        | 'unprocessed'
        | 'readyToMint'
        | 'missedMintingOpportunity'
    ]
): DepositStateNodeUnion {
    return {
        node: snapshot.state,
        data: snapshot,
    } as unknown as DepositStateNodeUnion;
}

function waitForDepositStateChange(
    current: DepositStateNodeUnion,
    check: () => Promise<
        (typeof DepositStateGraph.nodes)[
            | 'unprocessed'
            | 'readyToMint'
            | 'missedMintingOpportunity'
        ]
    >,
    setLatest: (
        snapshot: (typeof DepositStateGraph.nodes)[
            | 'unprocessed'
            | 'readyToMint'
            | 'missedMintingOpportunity'
        ]
    ) => void,
    pollIntervalMs: number
) {
    return new Observable<
        (typeof DepositStateGraph.nodes)[
            | 'unprocessed'
            | 'readyToMint'
            | 'missedMintingOpportunity'
        ]
    >((subscriber) => {
        let active = true;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        let node = current;

        const poll = async () => {
            try {
                const snapshot = await check();
                if (!active) return;

                setLatest(snapshot);

                if (node.node !== snapshot.state) {
                    subscriber.next(snapshot);
                    subscriber.complete();
                    return;
                }

                if (snapshot.state === DepositState.MissedMintingOpportunity) {
                    subscriber.complete();
                    return;
                }

                timeout = setTimeout(poll, pollIntervalMs);
            } catch (error) {
                subscriber.error(error);
            }
        };

        void poll();

        return () => {
            active = false;
            if (timeout) clearTimeout(timeout);
        };
    });
}

/**
 * Creates a cold polling transition factory for one deposit.
 *
 * @param bridgeAddress The Mina token bridge address.
 * @param depositTxHash The Ethereum transaction hash containing the deposit.
 * @param proofQueueAddress The Ethereum proof request queue address.
 * @param minaRpcProvider The Mina RPC/archive client used for all Mina reads.
 * @param provider The Ethereum provider shared by every poll of this transition.
 * @param bridgeTimeHeuristicMs The estimated interval between bridge updates.
 * @param initial The node from which the first transition begins.
 * @param pollIntervalMs The delay between unchanged state checks in milliseconds.
 * @returns A function that accepts a deposit node and emits its next state change.
 */
export function createDepositStateSnapshotTransition$(
    bridgeAddress: PublicKey,
    depositTxHash: string,
    proofQueueAddress: string,
    minaRpcProvider: MinaRpc,
    provider: EthereumProvider,
    bridgeTimeHeuristicMs?: number,
    initial: DepositStateNodeUnion = { node: 'undetermined', data: {} },
    pollIntervalMs = 15_000
) {
    const request = {
        bridgeAddress,
        depositTxHash,
        proofQueueAddress,
        minaRpcProvider,
        bridgeTimeHeuristicMs,
        provider,
    };
    let latest = initial;
    const setLatest = (
        snapshot: (typeof DepositStateGraph.nodes)[
            | 'unprocessed'
            | 'readyToMint'
            | 'missedMintingOpportunity'
        ]
    ) => {
        latest = toDepositStateNode(snapshot);
    };

    return (current: DepositStateNodeUnion = latest) => {
        if (current.node === DepositState.Undetermined) {
            return waitForDepositStateChange(
                current,
                () =>
                    getDepositStateSnapshot(
                        bridgeAddress,
                        depositTxHash,
                        proofQueueAddress,
                        minaRpcProvider,
                        provider,
                        bridgeTimeHeuristicMs
                    ),
                setLatest,
                pollIntervalMs
            );
        }

        if (current.node === DepositState.Unprocessed) {
            return waitForDepositStateChange(
                current,
                () => recheckUnprocessedDepositStateSnapshot(request, current.data),
                setLatest,
                pollIntervalMs
            );
        }

        if (current.node === DepositState.ReadyToMint) {
            return waitForDepositStateChange(
                current,
                () =>
                    recheckReadyToMintDepositStateSnapshot(
                        request,
                        current.data
                    ),
                setLatest,
                pollIntervalMs
            );
        }

        return new Observable<
            (typeof DepositStateGraph.nodes)[
                | 'unprocessed'
                | 'readyToMint'
                | 'missedMintingOpportunity'
            ]
        >((subscriber) => {
            subscriber.complete();
        });
    };
}
