import type { Endpoint } from '../types.js';

export const endpoint = 'archive' satisfies Endpoint;

export type Variables = {
    input: {
        address: string;
        tokenId: string;
        from: number;
        to: number;
    };
};

export type Response = {
    actions: Array<{
        blockInfo: {
            distanceFromMaxBlockHeight: number;
        };
        actionState: {
            actionStateOne: string;
            actionStateTwo: string;
        };
        actionData: Array<{
            accountUpdateId: string;
            data: string[];
            transactionInfo?: {
                sequenceNumber: number;
                zkappAccountUpdateIds: number[];
            };
        }>;
    }>;
};

export default `
  query FetchCommittedProofRequestsByBlockRange(
    $input: ActionFilterOptionsInput!
  ) {
    actions(input: $input) {
      blockInfo {
        distanceFromMaxBlockHeight
      }
      actionState {
        actionStateOne
        actionStateTwo
      }
      actionData {
        accountUpdateId
        data
        transactionInfo {
          sequenceNumber
          zkappAccountUpdateIds
        }
      }
    }
  }
`;
