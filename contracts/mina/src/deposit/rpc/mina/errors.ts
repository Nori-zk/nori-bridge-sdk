import type { Endpoint } from './types.js';

export type GraphqlErrorLocation = {
    line: number;
    column: number;
};

export type GraphqlError = {
    message: string;
    locations?: GraphqlErrorLocation[];
    path?: Array<string | number>;
    extensions?: Record<string, unknown>;
};

export class GraphqlTransportError extends Error {
    constructor(message: string, readonly cause: unknown) {
        super(message);
        this.name = 'GraphqlTransportError';
    }
}

export class GraphqlHttpError extends Error {
    constructor(
        readonly status: number,
        readonly statusText: string,
        readonly body: string
    ) {
        super(`GraphQL request failed with ${status} ${statusText}`);
        this.name = 'GraphqlHttpError';
    }
}

export class GraphqlResponseError extends Error {
    constructor(readonly errors: GraphqlError[]) {
        super(errors.map(({ message }) => message).join('; '));
        this.name = 'GraphqlResponseError';
    }
}

export class GraphqlProtocolError extends Error {
    constructor(message: string, readonly body: string) {
        super(message);
        this.name = 'GraphqlProtocolError';
    }
}

export type GraphqlEndpointFailure = {
    url: string;
    error: GraphqlTransportError | GraphqlHttpError;
};

export class GraphqlEndpointsExhaustedError extends Error {
    constructor(
        readonly endpoint: Endpoint,
        readonly failures: GraphqlEndpointFailure[]
    ) {
        super(`All ${endpoint} GraphQL endpoints were unavailable.`);
        this.name = 'GraphqlEndpointsExhaustedError';
    }
}
