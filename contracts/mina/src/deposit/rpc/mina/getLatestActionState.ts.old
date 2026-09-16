import { fetchAccount, type Field, type PublicKey, type UInt64 } from 'o1js';
import { NoriTokenBridge } from '../../../NoriTokenBridge.js';

export interface LatestActionState {
    /** Most recent action-state hash — the tip of the window's action chain. */
    actionState: Field;
    /** On-chain `windowStart` — the action-state hash at the oldest surviving job. */
    windowStart: Field;
    /** Number of jobs currently held in the window (<= maxWindow). */
    windowSize: Field;
    /** Number of proof-request queue entries settled so far. */
    queueCursor: UInt64;
}

/**
 * Reads the bridge zkApp's current window bookkeeping directly off-chain:
 * `windowStart`, `windowSize`, `queueCursor`, and the account's live
 * `actionState` tip. This is the anchor point for both eviction checks
 * (is a given job still within `windowSize` of the tip) and for the
 * heuristic/binary search in `findJobCoveringEthBlock`.
 */
export async function getLatestActionState(
    bridgeAddress: PublicKey
): Promise<LatestActionState> {
    const zkApp = new NoriTokenBridge(bridgeAddress);
    const { account } = await fetchAccount({ publicKey: bridgeAddress });
    if (!account?.zkapp) {
        throw new Error(
            `No zkApp account state found for ${bridgeAddress.toBase58()}.`
        );
    }
    const actionState = account.zkapp.actionState[0];
    const windowStart = zkApp.windowStart.get();
    const windowSize = zkApp.windowSize.get();
    const queueCursor = zkApp.queueCursor.get();
    return { actionState, windowStart, windowSize, queueCursor };
}
