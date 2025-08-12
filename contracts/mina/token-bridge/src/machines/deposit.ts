import { assign, fromObservable, fromPromise, setup } from 'xstate';
import {
    getCanComputeEthProof$,
    getCanMint$,
    getDepositProcessingStatus$,
} from '../rx/deposit.js';
import {
    getBridgeStateTopic$,
    getBridgeTimingsTopic$,
    getEthStateTopic$,
} from '../rx/topics.js';
import { Observable } from 'rxjs';

// Define actors

const depositProcessingStatusActor = fromObservable(
    ({
        input,
    }: {
        input: {
            depositBlockNumber: number;
            ethStateTopic$: ReturnType<typeof getEthStateTopic$>;
            bridgeStateTopic$: ReturnType<typeof getBridgeStateTopic$>;
            bridgeTimingsTopic$: ReturnType<typeof getBridgeTimingsTopic$>;
        };
    }) => {
        return getDepositProcessingStatus$(
            input.depositBlockNumber,
            input.ethStateTopic$,
            input.bridgeStateTopic$,
            input.bridgeTimingsTopic$
        );
    }
);

const canComputeEthProofActor = fromObservable(
    ({
        input,
    }: {
        input: {
            depositBlockNumber: number;
            ethStateTopic$: ReturnType<typeof getEthStateTopic$>;
            bridgeStateTopic$: ReturnType<typeof getBridgeStateTopic$>;
            bridgeTimingsTopic$: ReturnType<typeof getBridgeTimingsTopic$>;
        };
    }) => {
        return getCanComputeEthProof$(
            getDepositProcessingStatus$(
                input.depositBlockNumber,
                input.ethStateTopic$,
                input.bridgeStateTopic$,
                input.bridgeTimingsTopic$
            )
        );
    }
);

const canMintActor = fromObservable(
    ({
        input,
    }: {
        input: {
            depositBlockNumber: number;
            ethStateTopic$: ReturnType<typeof getEthStateTopic$>;
            bridgeStateTopic$: ReturnType<typeof getBridgeStateTopic$>;
            bridgeTimingsTopic$: ReturnType<typeof getBridgeTimingsTopic$>;
        };
    }) => {
        return getCanMint$(
            getDepositProcessingStatus$(
                input.depositBlockNumber,
                input.ethStateTopic$,
                input.bridgeStateTopic$,
                input.bridgeTimingsTopic$
            )
        );
    }
);

type ObservableValue<T> = T extends Observable<infer U> ? U : never;

// Define deposit machine with topics as initial context.

export const getDepositMachine = (initialContext: {
    ethStateTopic$: ReturnType<typeof getEthStateTopic$>;
    bridgeStateTopic$: ReturnType<typeof getBridgeStateTopic$>;
    bridgeTimingsTopic$: ReturnType<typeof getBridgeTimingsTopic$>;
}) =>
    setup({
        types: {
            context: {} as {
                activeDepositNumber: number | null;
                depositMintTx: string | null;
                computedEthProof: string | null;
                processingStatus: ObservableValue<
                    ReturnType<typeof getDepositProcessingStatus$>
                > | null;
                canComputeStatus: ObservableValue<
                    ReturnType<typeof getCanComputeEthProof$>
                > | null;
                canMintStatus: ObservableValue<
                    ReturnType<typeof getCanMint$>
                > | null;
                ethStateTopic$: ReturnType<typeof getEthStateTopic$>;
                bridgeStateTopic$: ReturnType<typeof getBridgeStateTopic$>;
                bridgeTimingsTopic$: ReturnType<typeof getBridgeTimingsTopic$>;
            },
            events: {} as
                | { type: 'SET_DEPOSIT_NUMBER'; value: number }
                | { type: 'CHECK_STATUS' }
                | { type: 'COMPUTE_ETH_PROOF' }
                | { type: 'BUILD_MINT_TX' }
                | { type: 'SUBMIT_MINT_TX' }
                | { type: 'RESET' },
        },
        guards: {
            hasComputedEthProof: ({ context }) =>
                context.computedEthProof !== null,
            hasDepositMintTx: ({ context }) => context.depositMintTx !== null,
            hasActiveDepositNumber: ({ context }) =>
                context.activeDepositNumber !== null,
            canComputeEthProof: ({ context }) =>
                context.canComputeStatus === 'CanCompute',
            canMint: ({ context }) => context.canMintStatus === 'ReadyToMint',
            isMissedOpportunity: ({ context }) =>
                context.canComputeStatus === 'MissedMintingOpportunity' ||
                context.canMintStatus === 'MissedMintingOpportunity',
        },
        actors: {
            depositProcessingStatusActor,
            canComputeEthProofActor,
            canMintActor,
            computeEthProofService: fromPromise(
                ({ input }: { input: { depositBlockNumber: number } }) => {
                    return new Promise<string>((resolve) => {
                        setTimeout(
                            () =>
                                resolve(
                                    `eth-proof-${input.depositBlockNumber}`
                                ),
                            1000
                        );
                    });
                }
            ),
            buildMintTxService: fromPromise(
                ({
                    input,
                }: {
                    input: { depositBlockNumber: number; ethProof: string };
                }) => {
                    return new Promise<string>((resolve) => {
                        setTimeout(
                            () =>
                                resolve(`mint-tx-${input.depositBlockNumber}`),
                            1000
                        );
                    });
                }
            ),
            submitMintTxService: fromPromise(
                ({ input }: { input: { mintTx: string } }) => {
                    return new Promise<void>((resolve) => {
                        setTimeout(() => {
                            console.log(`Submitted mint tx: ${input.mintTx}`);
                            resolve();
                        }, 1000);
                    });
                }
            ),
        },
    }).createMachine({
        id: 'deposit',
        initial: 'checking',
        context: {
            activeDepositNumber: (() => {
                const numStr = window.localStorage.getItem(
                    'activeDepositNumber'
                );
                return numStr !== null ? Number(numStr) : null;
            })(),
            depositMintTx: window.localStorage.getItem('depositMintTx'),
            computedEthProof: window.localStorage.getItem('computedEthProof'),
            processingStatus: null,
            canComputeStatus: null,
            canMintStatus: null,
            ethStateTopic$: initialContext.ethStateTopic$,
            bridgeStateTopic$: initialContext.bridgeStateTopic$,
            bridgeTimingsTopic$: initialContext.bridgeTimingsTopic$,
        },
        states: {
            checking: {
                entry: assign({
                    activeDepositNumber: () => {
                        const numStr = window.localStorage.getItem(
                            'activeDepositNumber'
                        );
                        return numStr !== null ? Number(numStr) : null;
                    },
                    depositMintTx: () =>
                        window.localStorage.getItem('depositMintTx'),
                    computedEthProof: () =>
                        window.localStorage.getItem('computedEthProof'),
                }),
                always: [
                    {
                        target: 'hasComputedEthProof',
                        guard: 'hasComputedEthProof',
                    },
                    { target: 'hasDepositMintTx', guard: 'hasDepositMintTx' },
                    {
                        target: 'hasActiveDepositNumber',
                        guard: 'hasActiveDepositNumber',
                    },
                    { target: 'noActiveDepositNumber' },
                ],
            },

            noActiveDepositNumber: {
                on: {
                    SET_DEPOSIT_NUMBER: {
                        actions: assign({
                            activeDepositNumber: ({ event }) => {
                                window.localStorage.setItem(
                                    'activeDepositNumber',
                                    event.value.toString()
                                );
                                return event.value;
                            },
                        }),
                        target: 'hasActiveDepositNumber',
                    },
                },
            },

            hasActiveDepositNumber: {
                entry: assign({
                    processingStatus: () => null as null,
                    canComputeStatus: () => null as null,
                    canMintStatus: () => null as null,
                }),
                invoke: [
                    {
                        id: 'depositProcessingStatus',
                        src: 'depositProcessingStatusActor',
                        input: ({ context }) => ({
                            depositBlockNumber: context.activeDepositNumber!,
                            ethStateTopic$: context.ethStateTopic$!,
                            bridgeStateTopic$: context.bridgeStateTopic$!,
                            bridgeTimingsTopic$: context.bridgeTimingsTopic$!,
                        }),
                        onSnapshot: {
                            actions: assign({
                                processingStatus: ({ event }) => {
                                    /*console.log(
                                        'onSnapshotdepositProcessingStatus',
                                        event
                                    );*/
                                    return event.snapshot.context;
                                },
                            }),
                        },
                    },
                    {
                        id: 'canComputeEthProof',
                        src: 'canComputeEthProofActor',
                        input: ({ context }) => ({
                            depositBlockNumber: context.activeDepositNumber!,
                            ethStateTopic$: context.ethStateTopic$!,
                            bridgeStateTopic$: context.bridgeStateTopic$!,
                            bridgeTimingsTopic$: context.bridgeTimingsTopic$!,
                        }),
                        onSnapshot: {
                            actions: assign({
                                canComputeStatus: ({ event }) => {
                                    /*console.log(
                                        'onSnapshotcanComputeEthProof',
                                        event
                                    );*/
                                    return event.snapshot.context;
                                },
                            }),
                        },
                    },
                    {
                        id: 'canMint',
                        src: 'canMintActor',
                        input: ({ context }) => ({
                            depositBlockNumber: context.activeDepositNumber!,
                            ethStateTopic$: context.ethStateTopic$!,
                            bridgeStateTopic$: context.bridgeStateTopic$!,
                            bridgeTimingsTopic$: context.bridgeTimingsTopic$!,
                        }),
                        onSnapshot: {
                            actions: assign({
                                canMintStatus: ({ event }) => {
                                    /*console.log(
                                        'onSnapshotcanMintActor',
                                        event
                                    );*/
                                    return event.snapshot.context;
                                },
                            }),
                        },
                    },
                ],
                always: [
                    {
                        target: 'checkingCanCompute',
                        guard: 'canComputeEthProof',
                    },
                    {
                        target: 'missedOpportunity',
                        guard: 'isMissedOpportunity',
                    },
                ],
            },

            checkingCanCompute: {
                invoke: {
                    src: 'canComputeEthProofActor',
                    input: ({ context }) => ({
                        depositBlockNumber: context.activeDepositNumber!,
                        ethStateTopic$: context.ethStateTopic$!,
                        bridgeStateTopic$: context.bridgeStateTopic$!,
                        bridgeTimingsTopic$: context.bridgeTimingsTopic$!,
                    }),
                    onSnapshot: {
                        actions: assign({
                            canComputeStatus: ({ event }) =>
                                event.snapshot.context,
                        }),
                    },
                },
                always: [
                    {
                        target: 'computingEthProof',
                        guard: 'canComputeEthProof',
                    },
                    {
                        target: 'missedOpportunity',
                        guard: 'isMissedOpportunity',
                    },
                ],
            },

            canComputeEvaluation: {
                always: [
                    {
                        target: 'computingEthProof',
                        guard: 'canComputeEthProof',
                    },
                    {
                        target: 'missedOpportunity',
                        guard: 'isMissedOpportunity',
                    },
                    { target: 'hasActiveDepositNumber' },
                ],
            },

            computingEthProof: {
                invoke: {
                    src: 'computeEthProofService',
                    input: ({ context }) => ({
                        depositBlockNumber: context.activeDepositNumber!,
                    }),
                    onDone: {
                        actions: assign({
                            computedEthProof: ({ event }) => {
                                const proof = event.output;
                                window.localStorage.setItem(
                                    'computedEthProof',
                                    proof
                                );
                                return proof;
                            },
                        }),
                        target: 'checking',
                    },
                },
            },

            hasComputedEthProof: {
                entry: assign({
                    canMintStatus: () => null as null,
                }),
                invoke: {
                    src: 'canMintActor',
                    input: ({ context }) => ({
                        depositBlockNumber: context.activeDepositNumber!,
                        ethStateTopic$: context.ethStateTopic$!,
                        bridgeStateTopic$: context.bridgeStateTopic$!,
                        bridgeTimingsTopic$: context.bridgeTimingsTopic$!,
                    }),
                    onSnapshot: {
                        actions: assign({
                            canMintStatus: ({ event }) =>
                                event.snapshot.context,
                        }),
                    },
                },
                always: [
                    { target: 'buildingMintTx', guard: 'canMint' },
                    {
                        target: 'missedOpportunity',
                        guard: 'isMissedOpportunity',
                    },
                    { target: 'hasComputedEthProof' },
                ],
            },

            canMintEvaluation: {
                always: [
                    { target: 'buildingMintTx', guard: 'canMint' },
                    {
                        target: 'missedOpportunity',
                        guard: 'isMissedOpportunity',
                    },
                    { target: 'hasComputedEthProof' },
                ],
            },

            buildingMintTx: {
                invoke: {
                    src: 'buildMintTxService',
                    input: ({ context }) => ({
                        depositBlockNumber: context.activeDepositNumber!,
                        ethProof: context.computedEthProof!,
                    }),
                    onDone: {
                        actions: assign({
                            depositMintTx: ({ event }) => {
                                const tx = event.output;
                                window.localStorage.setItem(
                                    'depositMintTx',
                                    tx
                                );
                                return tx;
                            },
                        }),
                        target: 'checking',
                    },
                },
            },

            hasDepositMintTx: {
                on: {
                    SUBMIT_MINT_TX: {
                        target: 'submittingMintTx',
                    },
                },
            },

            submittingMintTx: {
                invoke: {
                    src: 'submitMintTxService',
                    input: ({ context }) => ({
                        mintTx: context.depositMintTx!,
                    }),
                    onDone: {
                        target: 'completed',
                        actions: () => {
                            window.localStorage.removeItem(
                                'activeDepositNumber'
                            );
                            window.localStorage.removeItem('depositMintTx');
                            window.localStorage.removeItem('computedEthProof');
                        },
                    },
                },
            },

            missedOpportunity: {
                type: 'final',
                entry: () => console.log('Missed minting opportunity'),
            },

            completed: {
                type: 'final',
                entry: () => console.log('Deposit completed successfully'),
            },
        },
    });
