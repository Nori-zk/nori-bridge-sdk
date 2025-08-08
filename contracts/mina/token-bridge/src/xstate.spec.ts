import { firstValueFrom, map, switchMap, take } from 'rxjs';
import {
    canMint,
    getDepositProcessingStatus$,
    bridgeStatusesKnownEnoughToLockSafe,
    readyToComputeMintProof,
} from './rx/deposit.js';
import { getReconnectingBridgeSocket$ } from './rx/socket.js';
import { getBridgeStateWithTimings$ } from './rx/state.js';
import {
    getBridgeStateTopic$,
    getBridgeTimingsTopic$,
    getEthStateTopic$,
} from './rx/topics.js';
import { createActor, fromObservable, fromPromise } from 'xstate';
import { DeferredPromise } from './worker/index.js';

describe('XState integration example', () => {
    async function getNextDepositTarget(
        ethStateTopic$: ReturnType<typeof getEthStateTopic$>
    ) {
        const nextFinalizationTarget$ = ethStateTopic$.pipe(take(1));

        // This is just to get a recent block number dynamically from the bridge.
        const targetDepositNumber = await firstValueFrom(
            nextFinalizationTarget$.pipe(
                take(1),
                map(
                    ({ latest_finality_block_number }) =>
                        latest_finality_block_number + 10
                )
            )
        );

        return targetDepositNumber;
    }

    // Open a socket
    const { bridgeSocket$, bridgeSocketConnectionState$ } =
        getReconnectingBridgeSocket$();

    // Get bridge state topic streams
    const bridgeStateTopic$ = getBridgeStateTopic$(bridgeSocket$);
    const bridgeTimingsTopic$ = getBridgeTimingsTopic$(bridgeSocket$);
    const ethStateTopic$ = getEthStateTopic$(bridgeSocket$);

    test('xstate_should_integrate', async () => {
        // This is here just to prevent early test exit.
        const actorCompletion = new DeferredPromise();

        // For testing purposes get a blockNumber which the bridgehead cannot have processed yet:
        const targetDepositNumber = await getNextDepositTarget(ethStateTopic$);
        console.log('targetDepositNumber', targetDepositNumber);

        // Now demonstrate how integrate with XState:

        // Pre locking we need to know if it is plausable to lock:

        // Demonstrate how to construct an XState PromiseActorLogic for bridgeStatusesKnownEnoughToLockSafe
        // Note determine if we have enough state from the bridge head to support the entire procedure.
        const getCanLockXStatePromiseActorLogic = fromPromise(
            ({ input }: { input: { depositBlockNumber: number } }) => {
                const canLockPromise = bridgeStatusesKnownEnoughToLockSafe(
                    ethStateTopic$,
                    bridgeStateTopic$,
                    bridgeTimingsTopic$
                );
                return canLockPromise;
            }
        );

        // Post locking there are various things we need to know, including the overall status of the deposit given
        // the deposit block number, which can be used to drive the state machine(s):
        // - The deposits processing status
        // -

        // Demonstrate how to construct an XStateObservableActor for the DepositProcessingStatus/
        // Note this will deterministically work out the state of the deposit based on the state of the streams,
        // The only state required to restore the correct deposit status is the depositBlockNumber.
        const getDepositProcessingStatusXStateObservableActor = fromObservable<
            unknown,
            { depositBlockNumber: number }
        >(({ input: { depositBlockNumber } }) =>
            // Check the doc string for this function:
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
            ).pipe(
                map((state) => {
                    return { ...state, type: state.stage_name };
                })
            )
        );

        // Using the depositProcessingStatus$ we can drive any UI with events to inform them of progress. Also we can
        // use depositProcessingStatus$ observables to determine other key temporal trigger such as we can compute
        // our deposit proof:

        // Demonstrate how to construct an XState PromiseActorLogic for readyToComputeMintProof
        // Note this will deterministically work out if the deposit has reach a sufficient stage where we can attempt
        // to compute the ethDepositProof, one of the prerequisites to perform the minting process, given only the data
        // streams and a depositBlockNumber.
        const getCanComputeMintProofXStatePromiseActorLogic = fromPromise(
            async ({ input }: { input: { depositBlockNumber: number } }) => {
                const canComputeMintProofResult = readyToComputeMintProof(
                    getDepositProcessingStatus$(
                        input.depositBlockNumber,
                        ethStateTopic$,
                        bridgeStateTopic$,
                        bridgeTimingsTopic$
                    )
                );
                // This will resolve true when we can compute the proof, and will error with new Error('Minting opportunity missed.');
                // if we missed the window (it will not be possible to mint what was locked, the user would currently have to lock more to try again)
                return canComputeMintProofResult;
            }
        );

        // After the ethDepositProof has been calculate we still need to wait until the depositProcessingStatus has reached a
        // sufficient stage such that we can perform the minting process and send the minting transactions:

        // Demonstrate how to construct an XState PromiseActorLogic for canMint
        // Note will deterministically work out if minting is currently possible (its true for a finite window of time)
        // for any given deposit depending on the state of the websocket streams.
        // Note that in order to mint successfully one would have to have computed the deposit proof.
        const getCanMintXStatePromiseActorLogic = fromPromise(
            async ({ input }: { input: { depositBlockNumber: number } }) => {
                const canMintResult = canMint(
                    getDepositProcessingStatus$(
                        input.depositBlockNumber,
                        ethStateTopic$,
                        bridgeStateTopic$,
                        bridgeTimingsTopic$
                    )
                );
                // This will resolve true when we are in the window of time where we canLock, and will error with new Error('Minting opportunity missed.');
                // if we missed the window (it will not be possible to mint what was locked, the user would currently have to lock more to try again)
                return canMintResult;
            }
        );

        const depositActor = createActor(
            getDepositProcessingStatusXStateObservableActor,
            {
                input: { depositBlockNumber: targetDepositNumber },
            }
        );

        depositActor.subscribe(
            (snapshot) =>
                console.log({
                    status: snapshot.status,
                    context: snapshot.context,
                    output: snapshot.output,
                }),
            (error) => {
                actorCompletion.reject(error);
            },
            () => actorCompletion.resolve()
        );
        depositActor.start();

        // Block
        await actorCompletion.promise;
    }, 1000000000);
});
