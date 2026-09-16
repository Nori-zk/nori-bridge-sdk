import type { GraphqlError } from './errors.js';

export const endpoints = ['mina', 'archive'] as const;

export type Endpoint = (typeof endpoints)[number];

export type GraphqlVariables = Record<string, unknown>;

export type GraphqlResponse<Result> = {
    data?: Result;
    errors?: GraphqlError[];
};

export type GraphqlApi = Record<Endpoint, string | string[]>;
