import {
    Field,
    UInt64,
    Mina,
    fetchLastBlock as fetchLatestBlockMina,
    type PublicKey,
} from 'o1js';
import { Observable } from 'rxjs';
import { depositAge as depositAgeEth } from './rpc/eth/depositAge.js';
import { findRequestIdByTxHash } from './rpc/eth/fetchProofRequest.js';
import { getLatestActionState } from './rpc/mina/getLatestActionState.js';
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
}

async function decodeJobsInRange(
    bridgeAddress: PublicKey,
    fromHeight: number,
    toHeight: number
): Promise<CommittedProofRequests[]> {
    const result = await Mina.fetchActions(
        bridgeAddress,
        undefined,
        undefined,
        fromHeight,
        toHeight
    );
    if ('error' in result) {
        throw new Error(`fetchActions failed: ${JSON.stringify(result.error)}`);
    }
    return result.map(({ actions, hash }) => {
        const [
            rootStr,
            outputBlockNumberStr,
            inputQueueCursorStr,
            outputQueueCursorStr,
        ] = actions[0];
        return {
            root: Field(rootStr),
            outputBlockNumber: UInt64.from(BigInt(outputBlockNumberStr)),
            inputQueueCursor: UInt64.from(BigInt(inputQueueCursorStr)),
            outputQueueCursor: UInt64.from(BigInt(outputQueueCursorStr)),
            actionStateHash: hash,
        };
    });
}

interface DepositStateSnapshotRequest {
    bridgeAddress: PublicKey;
    depositTxHash: string;
    proofQueueAddress: string;
    archiveUrl: string;
    bridgeTimeHeuristicMs?: number;
}

interface CurrentBridgeWindow {
    queueCursor: bigint;
    latestOutputBlockNumber: bigint;
    currentMinaHeight: number;
    windowStart: Field;
    windowSize: Field;
    tipJob: CommittedProofRequests;
}

const ACTIONS_QUERY = `
  query GetWindowActions($accountAddress: String!, $fromActionState: String!) {
    actions(
      query: {
        accountAddress: { equalTo: $accountAddress }
        actionState: { greaterOrEqual: $fromActionState }
      }
      orderBy: ACTION_STATE_ASC
      first: 32
    ) {
      nodes {
        actionState
        actionsData
        transactionInfo {
          blockHeight
        }
      }
    }
  }
`;

async function fetchWindowActionsGraphQL(
    accountAddress: string,
    fromActionState: string,
    archiveUrl: string
) {
    const response = await fetch(archiveUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            query: ACTIONS_QUERY,
            variables: { accountAddress, fromActionState },
        }),
    });
    const json = await response.json();
    if (json.errors)
        throw new Error(`GraphQL error: ${JSON.stringify(json.errors)}`);
    return json.data.actions.nodes;
}

async function getCurrentBridgeWindow(
    bridgeAddress: PublicKey
): Promise<CurrentBridgeWindow> {
    const latestState = await getLatestActionState(bridgeAddress);
    const queueCursor = latestState.queueCursor.toBigInt();
    const windowStart = latestState.windowStart;
    const windowSize = latestState.windowSize;

    const lastBlockMina = await fetchLatestBlockMina();
    const currentMinaHeight = Number(lastBlockMina.blockchainLength.toBigint());
    const tipActions = await decodeJobsInRange(
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
    windowNodes: { actionsData?: string[] }[],
    committedProofRequest: {
        root: Field;
        outputBlockNumber: bigint;
        inputQueueCursor: bigint;
        outputQueueCursor: bigint;
    }
) {
    for (let i = 0; i < windowNodes.length; i++) {
        const node = windowNodes[i];
        const actionsData = node.actionsData;
        if (!actionsData || actionsData.length === 0) continue;
        const [
            rootStr,
            outputBlockNumberStr,
            inputQueueCursorStr,
            outputQueueCursorStr,
        ] = actionsData;
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
    const depositAgeMs = await depositAgeEth(depositBlockNumber);
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

    const accountAddress = request.bridgeAddress.toBase58();
    const windowNodes = await fetchWindowActionsGraphQL(
        accountAddress,
        windowStart.toString(),
        request.archiveUrl
    );

    const position = findCommittedProofRequestPositionInDepositActionWindow(windowNodes, {
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
    return {
        state: DepositState.ReadyToMint,
        depositRequestId,
        depositBlockNumber,
        queueCursor,
        root: aboveJob.root,
        inputQueueCursor: inputCursor,
        outputQueueCursor: outputCursor,
        outputBlockNumber,
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
    const currentWindow = await getCurrentBridgeWindow(request.bridgeAddress);
    const windowNodes = await fetchWindowActionsGraphQL(
        request.bridgeAddress.toBase58(),
        currentWindow.windowStart.toString(),
        request.archiveUrl
    );
    const position =
        findCommittedProofRequestPositionInDepositActionWindow(
            windowNodes,
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
    const currentWindow = await getCurrentBridgeWindow(request.bridgeAddress);
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

export async function getDepositStateSnapshot(
    bridgeAddress: PublicKey,
    depositTxHash: string,
    proofQueueAddress: string,
    archiveUrl: string,
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
        depositTxHash
    );
    const depositRequestId = requestData.requestId;
    const depositBlockNumber = BigInt(requestData.blockNumber);
    const request = {
        bridgeAddress,
        depositTxHash,
        proofQueueAddress,
        archiveUrl,
        bridgeTimeHeuristicMs,
    };

    const currentWindow = await getCurrentBridgeWindow(bridgeAddress);

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

export async function recheckDepositStateSnapshot(
    current: DepositStateNodeUnion,
    bridgeAddress: PublicKey,
    depositTxHash: string,
    proofQueueAddress: string,
    archiveUrl: string,
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
        archiveUrl,
        bridgeTimeHeuristicMs,
    };

    if (current.node === DepositState.Undetermined) {
        return getDepositStateSnapshot(
            bridgeAddress,
            depositTxHash,
            proofQueueAddress,
            archiveUrl,
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

export function createDepositStateSnapshotTransition$(
    bridgeAddress: PublicKey,
    depositTxHash: string,
    proofQueueAddress: string,
    archiveUrl: string,
    bridgeTimeHeuristicMs?: number,
    initial: DepositStateNodeUnion = { node: 'undetermined', data: {} },
    pollIntervalMs = 15_000
) {
    const request = {
        bridgeAddress,
        depositTxHash,
        proofQueueAddress,
        archiveUrl,
        bridgeTimeHeuristicMs,
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
                        archiveUrl,
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
