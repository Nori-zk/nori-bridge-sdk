import type { Endpoint } from '../types.js';

export const endpoint = 'mina' satisfies Endpoint;

export type Variables = Record<string, never>;

export type Response = {
    bestChain: Array<{
        protocolState: {
            consensusState: {
                blockHeight: string;
            };
        };
    }>;
};

export default `
  query FetchLatestBlock {
    bestChain(maxLength: 1) {
      protocolState {
        blockchainState {
          snarkedLedgerHash
          stagedLedgerHash
          date
          utcDate
          stagedLedgerProofEmitted
        }
        previousStateHash
        consensusState {
          blockHeight
          slotSinceGenesis
          slot
          nextEpochData {
            ledger {
              hash
              totalCurrency
            }
            seed
            startCheckpoint
            lockCheckpoint
            epochLength
          }
          stakingEpochData {
            ledger {
              hash
              totalCurrency
            }
            seed
            startCheckpoint
            lockCheckpoint
            epochLength
          }
          epochCount
          minWindowDensity
          totalCurrency
          epoch
        }
      }
    }
  }
`;
