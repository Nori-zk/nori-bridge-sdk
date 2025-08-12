import {
    getCanComputeEthProof$,
    getCanMint$,
    getDepositProcessingStatus$,
} from '../rx/deposit.js';
import { getReconnectingBridgeSocket$ } from '../rx/socket.js';
import {
    getBridgeStateTopic$,
    getBridgeTimingsTopic$,
    getEthStateTopic$,
} from '../rx/topics.js';
import { assign, fromObservable, setup } from 'xstate';

const { bridgeSocket$, bridgeSocketConnectionState$ } =
    getReconnectingBridgeSocket$();

// Get bridge state topic streams
const bridgeStateTopic$ = getBridgeStateTopic$(bridgeSocket$);
const bridgeTimingsTopic$ = getBridgeTimingsTopic$(bridgeSocket$);
const ethStateTopic$ = getEthStateTopic$(bridgeSocket$);

// Define actors
const getBridgeSocketConnectionStateXStateObservableActor = fromObservable(
    () => bridgeSocketConnectionState$
);

const getDepositProcessingStatusXStateObservableActor = fromObservable<
    unknown,
    { depositBlockNumber: number }
>(({ input: { depositBlockNumber } }) =>
    /*
        The stream emits objects containing the current bridge state, estimated time remaining, elapsed time, 
        deposit processing status, and the original deposit block number. It transitions through various statuses
        such as WaitingForEthFinality, WaitingForCurrentJobCompletion, ReadyToMint, or MissedMintingOpportunity.
    */
    getDepositProcessingStatus$(
        depositBlockNumber,
        ethStateTopic$,
        bridgeStateTopic$,
        bridgeTimingsTopic$
    )
);

// If we canCompute we can generate our EthDepositProof

const getCanComputeMintProofXStateObservableActor = fromObservable<
    unknown,
    { depositBlockNumber: number }
>(({ input: { depositBlockNumber } }) =>
    getCanComputeEthProof$( // cycles through states of 'Waiting', 'CanCompute', or 'MissedMintingOpportunity'
        getDepositProcessingStatus$(
            depositBlockNumber,
            ethStateTopic$,
            bridgeStateTopic$,
            bridgeTimingsTopic$
        )
    )
);

// If we have our EthDepositProof and we are ReadyToMint we can build our dummy mintTxProofTx

const getCanMintProofXStateObservableActor = fromObservable<
    unknown,
    { depositBlockNumber: number }
>(({ input: { depositBlockNumber } }) =>
    getCanMint$( // cycles through states of 'Waiting', 'ReadyToMint' and 'MissedMintingOpportunity'
        getDepositProcessingStatus$(
            depositBlockNumber,
            ethStateTopic$,
            bridgeStateTopic$,
            bridgeTimingsTopic$
        )
    )
);

// When we have our mintTxProofTx we are ready to send mintTxProofTx so long as we havent MissedMintingOpportunity

export const depositMachine = setup({
    types: {
        context: {} as {
            activeDepositNumber: number | null;
            depositMintTx: string | null;
            computedEthProof: string | null;
        },
    },
    guards: {
        hasComputedEthProof: ({ context }) => context.computedEthProof !== null,
        hasDepositMintTx: ({ context }) => context.depositMintTx !== null,
        hasActiveDepositNumber: ({ context }) =>
            context.activeDepositNumber !== null,
    },
}).createMachine({
    id: 'deposit',
    initial: 'checking',
    context: {
        activeDepositNumber: (() => {
            const numStr = window.localStorage.getItem('activeDepositNumber');
            return numStr !== null ? Number(numStr) : null;
        })(),
        depositMintTx: window.localStorage.getItem('depositMintTx'),
        computedEthProof: window.localStorage.getItem('computedEthProof'),
    },
    states: {
        checking: {
            entry: assign((context) => ({
                activeDepositNumber: (() => {
                    const numStr = window.localStorage.getItem(
                        'activeDepositNumber'
                    );
                    return numStr !== null ? Number(numStr) : null;
                })(),
                depositMintTx: window.localStorage.getItem('depositMintTx'),
                computedEthProof:
                    window.localStorage.getItem('computedEthProof'),
            })),
            always: [
                { target: 'hasComputedEthProof', guard: 'hasComputedEthProof' },
                { target: 'hasDepositMintTx', guard: 'hasDepositMintTx' },
                {
                    target: 'hasActiveDepositNumber',
                    guard: 'hasActiveDepositNumber',
                },
                { target: 'noActiveDepositNumber' },
            ],
        },
        hasComputedEthProof: { type: 'final' },
        hasDepositMintTx: { type: 'final' },
        hasActiveDepositNumber: { type: 'final' },
        noActiveDepositNumber: { type: 'final' },
    },
});
