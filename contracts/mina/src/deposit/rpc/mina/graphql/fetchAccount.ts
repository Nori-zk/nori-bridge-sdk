import type { Endpoint } from '../types.js';

export const endpoint = 'mina' satisfies Endpoint;

export type Variables = {
    publicKey: string;
    tokenId: string;
};

export type Response = {
    account: {
        zkappState: string[];
        actionState: string[];
    } | null;
};

export default `
  query FetchAccount($publicKey: String!, $tokenId: String!) {
    account(publicKey: $publicKey, token: $tokenId) {
      publicKey
      token
      nonce
      balance {
        total
      }
      tokenSymbol
      receiptChainHash
      timing {
        initialMinimumBalance
        cliffTime
        cliffAmount
        vestingPeriod
        vestingIncrement
      }
      permissions {
        editState
        access
        send
        receive
        setDelegate
        setPermissions
        setVerificationKey {
          auth
          txnVersion
        }
        setZkappUri
        editActionState
        setTokenSymbol
        incrementNonce
        setVotingFor
        setTiming
      }
      delegateAccount {
        publicKey
      }
      votingFor
      zkappState
      verificationKey {
        verificationKey
        hash
      }
      actionState
      provedState
      zkappUri
    }
  }
`;
