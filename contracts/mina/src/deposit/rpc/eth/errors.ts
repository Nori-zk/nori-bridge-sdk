export class EthRpcTransportError extends Error {
    constructor(message: string, readonly cause: unknown) {
        super(message);
        this.name = 'EthRpcTransportError';
    }
}

export class EthCallFailedError extends Error {
    constructor(message: string, readonly cause: unknown) {
        super(message);
        this.name = 'EthCallFailedError';
    }
}

export class MalformedProofRequestError extends Error {
    constructor(readonly requestId: bigint, message: string) {
        super(message);
        this.name = 'MalformedProofRequestError';
    }
}

export class EthDataNotFoundError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'EthDataNotFoundError';
    }
}

export type ProofRequestFailureCause =
    | EthRpcTransportError
    | EthCallFailedError
    | MalformedProofRequestError;

export type ProofRequestBatchFailure = {
    requestIds: bigint[];
    error: ProofRequestFailureCause;
};

export class ProofRequestBatchFetchError extends Error {
    constructor(readonly failures: ProofRequestBatchFailure[]) {
        const count = failures.reduce((total, failure) => total + failure.requestIds.length, 0);
        super(`Failed to fetch ${count} of the queue's proof requests.`);
        this.name = 'ProofRequestBatchFetchError';
    }
}
