// ---------------------------------------------------------------------------
// Deposit-root window helpers (reusable for client code)
// ---------------------------------------------------------------------------

import { fetchAccount, type Field, Reducer } from 'o1js';
import type { NoriTokenBridge } from './NoriTokenBridge.js';

/**
 * Fetch the deposit-root actions currently in the contract's active window.
 * Reads `windowStart` from on-chain state and fetches actions from that
 * action-state hash forward to the current tip.
 * Returns a flat array of Field values in dispatch order.
 */
export async function fetchWindowRoots(bridge: NoriTokenBridge): Promise<Field[]> {
    await fetchAccount({ publicKey: bridge.address });
    const windowStart = bridge.windowStart.get();
    const actionBatches: Field[][] = await bridge.reducer.fetchActions({
        fromActionState: windowStart,
    });
    return actionBatches.flat();
}

/**
 * Fetch ALL dispatched deposit-root actions from genesis.
 * Useful for debugging / full history, but prefer `fetchWindowRoots`
 * for normal operation.
 */
export async function fetchAllDispatchedRoots(
    bridge: NoriTokenBridge
): Promise<Field[]> {
    const actionBatches: Field[][] = await bridge.reducer.fetchActions({
        fromActionState: Reducer.initialActionState,
    });
    return actionBatches.flat();
}
