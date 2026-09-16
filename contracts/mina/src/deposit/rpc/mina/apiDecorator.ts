import type {
    Endpoint,
    GraphqlApi,
    GraphqlResponse,
    GraphqlVariables,
} from './types.js';
import {
    GraphqlEndpointsExhaustedError,
    GraphqlHttpError,
    GraphqlProtocolError,
    GraphqlResponseError,
    GraphqlTransportError,
    type GraphqlEndpointFailure,
} from './errors.js';

function shouldTryFallback(status: number): boolean {
    return status === 502 || status === 503 || status === 504;
}

export function graphql<Result>(
    query: string,
    endpoint: Endpoint
): MethodDecorator {
    return (_target, propertyKey, descriptor) => {
        const methodDescriptor = descriptor as PropertyDescriptor;
        const createVariables = methodDescriptor.value as
            | ((...args: unknown[]) => GraphqlVariables)
            | undefined;

        if (!createVariables) {
            throw new TypeError(
                `@graphql can only decorate a method: ${String(propertyKey)}`
            );
        }

        methodDescriptor.value = async function (
            this: GraphqlApi & { graphqlFetch: typeof fetch },
            ...args: unknown[]
        ): Promise<Result> {
            const variables = createVariables.apply(this, args);
            const urls = Array.isArray(this[endpoint])
                ? this[endpoint]
                : [this[endpoint]];
            const failures: GraphqlEndpointFailure[] = [];

            for (const url of urls) {
                let response: Response;

                try {
                    response = await this.graphqlFetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ query, variables }),
                    });
                } catch (error) {
                    failures.push({
                        url,
                        error: new GraphqlTransportError(
                            `GraphQL request to ${url} failed.`,
                            error
                        ),
                    });
                    continue;
                }

                let body: string;

                try {
                    body = await response.text();
                } catch (error) {
                    failures.push({
                        url,
                        error: new GraphqlTransportError(
                            `GraphQL response from ${url} could not be read.`,
                            error
                        ),
                    });
                    continue;
                }

                if (!response.ok) {
                    const error = new GraphqlHttpError(
                        response.status,
                        response.statusText,
                        body
                    );

                    if (shouldTryFallback(response.status)) {
                        failures.push({ url, error });
                        continue;
                    }

                    throw error;
                }

                let result: GraphqlResponse<Result>;

                try {
                    result = JSON.parse(body) as GraphqlResponse<Result>;
                } catch {
                    throw new GraphqlProtocolError(
                        'GraphQL response was not valid JSON.',
                        body
                    );
                }

                if (result.errors && result.errors.length > 0) {
                    throw new GraphqlResponseError(result.errors);
                }

                if (result.data === undefined) {
                    throw new Error('GraphQL response did not include data.');
                }

                return result.data;
            }

            if (failures.length > 0) {
                throw new GraphqlEndpointsExhaustedError(endpoint, failures);
            }

            throw new TypeError(
                `No ${endpoint} GraphQL endpoints were configured.`
            );
        };
    };
}

export namespace graphql {
    export function variables<Result>(
        variables: GraphqlVariables
    ): Promise<Result> {
        return variables as unknown as Promise<Result>;
    }
}
