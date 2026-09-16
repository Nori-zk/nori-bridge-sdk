import { Field, TokenId, type PublicKey } from 'o1js';
import { NoriTokenBridge } from '../../../NoriTokenBridge.js';
import { graphql } from './apiDecorator.js';
import fetchAccountQuery, {
    endpoint as fetchAccountEndpoint,
    type Response as FetchAccountResponse,
    type Variables as FetchAccountVariables,
} from './graphql/fetchAccount.js';
import fetchCommittedProofRequestsByBlockRangeQuery, {
    endpoint as fetchCommittedProofRequestsByBlockRangeEndpoint,
    type Response as FetchCommittedProofRequestsByBlockRangeResponse,
    type Variables as FetchCommittedProofRequestsByBlockRangeVariables,
} from './graphql/fetchCommittedProofRequestsByBlockRange.js';
import fetchLatestBlockQuery, {
    endpoint as fetchLatestBlockEndpoint,
    type Response as FetchLatestBlockResponse,
    type Variables as FetchLatestBlockVariables,
} from './graphql/fetchLatestBlock.js';
import fetchWindowActionsQuery, {
    endpoint as fetchWindowActionsEndpoint,
    type Response as FetchWindowActionsResponse,
    type Variables as FetchWindowActionsVariables,
} from './graphql/fetchWindowActions.js';
import type { GraphqlApi } from './types.js';

export class MinaRpc implements GraphqlApi {
    readonly mina: string | string[];
    readonly archive: string | string[];

    constructor(
        { mina, archive }: GraphqlApi,
        readonly graphqlFetch: typeof fetch = fetch
    ) {
        this.mina = mina;
        this.archive = archive;
    }

    @graphql<FetchAccountResponse>(fetchAccountQuery, fetchAccountEndpoint)
    fetchAccount(
        publicKey: PublicKey,
        tokenId: string
    ): Promise<FetchAccountResponse> {
        return graphql.variables<FetchAccountResponse>({
            publicKey: publicKey.toBase58(),
            tokenId,
        } satisfies FetchAccountVariables);
    }

    async getLatestActionState(bridgeAddress: PublicKey) {
        const { account } = await this.fetchAccount(
            bridgeAddress,
            TokenId.toBase58(TokenId.default)
        );

        if (!account) {
            throw new Error(
                `No zkApp account state found for ${bridgeAddress.toBase58()}.`
            );
        }

        const actionState = account.actionState[0];

        if (!actionState) {
            throw new Error(
                `No action state found for ${bridgeAddress.toBase58()}.`
            );
        }

        const bridge = new NoriTokenBridge(bridgeAddress);
        const appState = account.zkappState.map(Field);

        return {
            actionState: Field(actionState),
            windowStart: bridge.windowStart.fromAppState(appState),
            windowSize: bridge.windowSize.fromAppState(appState),
            queueCursor: bridge.queueCursor.fromAppState(appState),
        };
    }

    @graphql<FetchLatestBlockResponse>(
        fetchLatestBlockQuery,
        fetchLatestBlockEndpoint
    )
    fetchLatestBlock(): Promise<FetchLatestBlockResponse> {
        return graphql.variables<FetchLatestBlockResponse>(
            {} satisfies FetchLatestBlockVariables
        );
    }

    @graphql<FetchCommittedProofRequestsByBlockRangeResponse>(
        fetchCommittedProofRequestsByBlockRangeQuery,
        fetchCommittedProofRequestsByBlockRangeEndpoint
    )
    fetchCommittedProofRequestsByBlockRange(
        bridgeAddress: PublicKey,
        fromBlockHeight: number,
        toBlockHeight: number
    ): Promise<FetchCommittedProofRequestsByBlockRangeResponse> {
        return graphql.variables<FetchCommittedProofRequestsByBlockRangeResponse>(
            {
                input: {
                    address: bridgeAddress.toBase58(),
                    tokenId: TokenId.toBase58(TokenId.default),
                    from: fromBlockHeight,
                    to: toBlockHeight,
                },
            } satisfies FetchCommittedProofRequestsByBlockRangeVariables
        );
    }

    @graphql<FetchWindowActionsResponse>(
        fetchWindowActionsQuery,
        fetchWindowActionsEndpoint
    )
    fetchWindowActions(
        bridgeAddress: PublicKey,
        fromActionState: Field
    ): Promise<FetchWindowActionsResponse> {
        return graphql.variables<FetchWindowActionsResponse>({
            input: {
                address: bridgeAddress.toBase58(),
                tokenId: TokenId.toBase58(TokenId.default),
                fromActionState: fromActionState.toString(),
            },
        } satisfies FetchWindowActionsVariables);
    }
}
