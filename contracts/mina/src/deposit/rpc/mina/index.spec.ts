import { Field, PublicKey, TokenId } from 'o1js';
import { env } from '../../../env.js';
import { MinaRpc } from './index.js';

const staging = env.mina?.staging;

if (!staging) {
    throw new Error('Mina staging environment is not configured.');
}

const bridgeAddress = PublicKey.fromBase58(
    staging.NORI_MINA_TOKEN_BRIDGE_ADDRESS
);

const rpc = new MinaRpc({
    mina: staging.MINA_RPC_NETWORK_URL,
    archive: staging.MINA_ARCHIVE_RPC_URL,
});

describe('MinaRpc staging integration', () => {
    test('should fetch the bridge account from the Mina daemon', async () => {
        const response = await rpc.fetchAccount(
            bridgeAddress,
            TokenId.toBase58(TokenId.default)
        );

        expect(response.account).not.toBeNull();
        expect(response.account?.zkappState).toEqual(
            expect.any(Array)
        );
        expect(response.account?.actionState).toEqual(
            expect.any(Array)
        );
    });

    test('should fetch the latest block from the Mina daemon', async () => {
        const response = await rpc.fetchLatestBlock();
        const latestBlock = response.bestChain[0];

        expect(latestBlock).toBeDefined();
        expect(
            BigInt(latestBlock?.protocolState.consensusState.blockHeight ?? 0)
        ).toBeGreaterThan(0n);
    });

    test('should decode the latest bridge action state', async () => {
        const state = await rpc.getLatestActionState(bridgeAddress);

        expect(state.actionState.toString()).not.toHaveLength(0);
        expect(state.windowStart.toString()).not.toHaveLength(0);
        expect(state.windowSize.toBigInt()).toBeGreaterThanOrEqual(0n);
        expect(state.queueCursor.toBigInt()).toBeGreaterThanOrEqual(0n);
    });

    test('should fetch committed proof requests from the archive', async () => {
        const latestBlock = await rpc.fetchLatestBlock();
        const blockHeight = Number(
            latestBlock.bestChain[0]?.protocolState.consensusState.blockHeight
        );
        const response = await rpc.fetchCommittedProofRequestsByBlockRange(
            bridgeAddress,
            blockHeight,
            blockHeight
        );

        expect(response.actions).toEqual(expect.any(Array));
    });

    test('should fetch window actions from the archive', async () => {
        const account = await rpc.fetchAccount(
            bridgeAddress,
            TokenId.toBase58(TokenId.default)
        );
        const actionState = account.account?.actionState[0];

        expect(actionState).toBeDefined();

        if (!actionState) {
            throw new Error('Bridge account did not include an action state.');
        }

        const response = await rpc.fetchWindowActions(
            bridgeAddress,
            Field(actionState)
        );

        expect(response.actions).toEqual(expect.any(Array));
    });
});
