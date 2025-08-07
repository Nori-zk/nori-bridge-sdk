import { filter, firstValueFrom, map } from 'rxjs';
import {
    BridgeDepositProcessingStatus,
    canMint,
    getDepositProcessingStatus$,
    readyToComputeMintProof,
} from './deposit.js';
import { getReconnectingBridgeSocket$ } from './socket.js';
import {
    getBridgeStateTopic$,
    getBridgeTimingsTopic$,
    getEthStateTopic$,
} from './topics.js';
import { TransitionNoticeMessageType } from '@nori-zk/pts-types';

describe('Deposit tests', () => {
    const { bridgeSocket$ } = getReconnectingBridgeSocket$();

    const bridgeStateTopic$ = getBridgeStateTopic$(bridgeSocket$);
    const bridgeTimingsTopic$ = getBridgeTimingsTopic$(bridgeSocket$);
    const ethStateTopic$ = getEthStateTopic$(bridgeSocket$);

    test('missed_window_deposits_should_emit_expected_status_and_complete', (done) => {
        expect.assertions(1);

        const depositProcessingStatus$ = getDepositProcessingStatus$(
            0,
            ethStateTopic$,
            bridgeStateTopic$,
            bridgeTimingsTopic$
        );

        depositProcessingStatus$.subscribe({
            next: ({ deposit_processing_status }) => {
                expect(deposit_processing_status).toBe(
                    BridgeDepositProcessingStatus.MissedMintingOpportunity
                );
            },
            error: (err) => done(err),
            complete: () => done(),
        });
    });

    test('readyToComputeMintProof_should_throw_if_missed_mint_opportunity', () => {
        const depositProcessingStatus$ = getDepositProcessingStatus$(
            0,
            ethStateTopic$,
            bridgeStateTopic$,
            bridgeTimingsTopic$
        );

        expect(
            readyToComputeMintProof(depositProcessingStatus$)
        ).rejects.toThrow('Minting opportunity missed.');
    });

    test('canMint_should_throw_if_missed_mint_opportunity', () => {
        const depositProcessingStatus$ = getDepositProcessingStatus$(
            0,
            ethStateTopic$,
            bridgeStateTopic$,
            bridgeTimingsTopic$
        );

        expect(canMint(depositProcessingStatus$)).rejects.toThrow(
            'Minting opportunity missed.'
        );
    });

    function getLatestBridgeJobInputNumbers() {
        return firstValueFrom(
            bridgeStateTopic$.pipe(
                map((bridgeState) => {
                    const { input_block_number, output_block_number } =
                        bridgeState;
                    return { input_block_number, output_block_number };
                })
            )
        );
    }

    function isValidBridgeState(bridgeState: any): bridgeState is {
        last_finalized_job: { input_block_number: number };
        input_block_number: number;
    } {
        return (
            bridgeState.last_finalized_job !== 'unknown' &&
            typeof bridgeState.last_finalized_job?.input_block_number ===
                'number' &&
            typeof bridgeState.input_block_number === 'number'
        );
    }

    function getLastBridgeJobInputNumber() {
        return firstValueFrom(
            bridgeStateTopic$.pipe(
                filter(isValidBridgeState),
                filter(
                    (bridgeState) =>
                        bridgeState.last_finalized_job.input_block_number !==
                        bridgeState.input_block_number
                ),
                map(
                    (bridgeState) =>
                        bridgeState.last_finalized_job.input_block_number
                )
            )
        );
    }

    test('should_be_able_to_mint_if_we_are_in_the_window', async () => {
        const latestBlockInputNumbers = await getLatestBridgeJobInputNumbers();
        const depositProcessingStatus$ = getDepositProcessingStatus$(
            latestBlockInputNumbers.input_block_number,
            ethStateTopic$,
            bridgeStateTopic$,
            bridgeTimingsTopic$
        );

        expect(canMint(depositProcessingStatus$)).resolves.toBe(true);
    });

    test('should_immediately_be_able_to_compute_mint_proof_if_we_are_in_the_current_window', async () => {
        const latestBlockInputNumbers = await getLatestBridgeJobInputNumbers();
        console.log('Using latestBlockInputNumber:', latestBlockInputNumbers);
        const depositProcessingStatus$ = getDepositProcessingStatus$(
            latestBlockInputNumbers.input_block_number,
            ethStateTopic$,
            bridgeStateTopic$,
            bridgeTimingsTopic$
        );

        // Subscribe while we are waiting.
        const depositProcessingStatusSubscription =
            depositProcessingStatus$.subscribe({
                next: (value) => console.log('[Latest inside] Next:', value),
                error: (error) =>
                    console.error('[Latest inside] Error:', error),
                complete: () => console.log('[Latest inside] Complete'),
            });

        const readyToComputeMintProofResult = readyToComputeMintProof(
            depositProcessingStatus$
        );
        expect(readyToComputeMintProofResult).resolves.toBe(true);
        await readyToComputeMintProofResult
            .catch(() => null as null)
            .then(() => depositProcessingStatusSubscription.unsubscribe());
    }, 1200000); // 20 minutes timeout

    test('should_eventually_be_able_to_compute_mint_proof_if_we_are_just_outside_the_current_window', async () => {
        const latestBlockInputNumber =
            (await getLatestBridgeJobInputNumbers()).output_block_number + 1;
        console.log('Using latestBlockInputNumber:', latestBlockInputNumber);
        const depositProcessingStatus$ = getDepositProcessingStatus$(
            latestBlockInputNumber,
            ethStateTopic$,
            bridgeStateTopic$,
            bridgeTimingsTopic$
        );

        // Subscribe while we are waiting.
        const depositProcessingStatusSubscription =
            depositProcessingStatus$.subscribe({
                next: (value) => console.log('[Latest outside] Next:', value),
                error: (error) =>
                    console.error('[Latest outside] Error:', error),
                complete: () => console.log('[Latest outside] Complete'),
            });

        const readyToComputeMintProofResult = readyToComputeMintProof(
            depositProcessingStatus$
        );
        expect(readyToComputeMintProofResult).resolves.toBe(true);
        await readyToComputeMintProofResult
            .catch(() => null as null)
            .then(() => depositProcessingStatusSubscription.unsubscribe());
    }, 1200000); // 20 minutes timeout

    test('should_possibly_be_able_to_compute_mint_proof_if_we_are_in_the_last_window_if_not_finalized', async () => {
        const lastBlockInputNumber = await getLastBridgeJobInputNumber();
        console.log('Using lastBlockInputNumber:', lastBlockInputNumber);

        const depositProcessingStatus$ = getDepositProcessingStatus$(
            lastBlockInputNumber,
            ethStateTopic$,
            bridgeStateTopic$,
            bridgeTimingsTopic$
        );

        // Track last emitted status to validate on error
        let lastEmittedStatus: {
            stage_name?: string;
            deposit_block_number?: number;
            last_finalized_job?:
                | { input_block_number: number; output_block_number: number }
                | 'unknown';
        } = {};

        // Subscribe to update lastEmittedStatus on each emission
        const depositProcessingStatusSubscription =
            depositProcessingStatus$.subscribe({
                next: (value) => {
                    lastEmittedStatus = value;
                    console.log('[Last] Next:', value);
                },
                error: (error) => console.error('[Last] Error:', error),
                complete: () => console.log('[Last] Complete'),
            });

        try {
            const result = await readyToComputeMintProof(
                depositProcessingStatus$
            );
            expect(result).toBe(true);
            console.log('lastBlockNumber true case');
        } catch (e) {
            // FIXME actually witness this happening! Assuming it works for today. Dont think it is
            // FIXME EthProcessorTransactionFinalizationSucceeded IS probably too late
            console.log('lastBlockNumber error case');
            expect(e).toBeInstanceOf(Error);
            const error = e as Error;
            expect(error.message).toBe('Minting opportunity missed.');

            // Assert that error only occurs if stage_name is EthProcessorTransactionFinalizationSucceeded
            expect(lastEmittedStatus.stage_name).toBe(
                TransitionNoticeMessageType.EthProcessorTransactionFinalizationSucceeded
            );

            // Assert deposit_block_number falls within last finalized job range
            if (lastEmittedStatus.last_finalized_job !== 'unknown') {
                const { input_block_number, output_block_number } =
                    lastEmittedStatus.last_finalized_job;
                const depositBlockNumber =
                    lastEmittedStatus.deposit_block_number!;
                expect(depositBlockNumber).toBeGreaterThanOrEqual(
                    input_block_number
                );
                expect(depositBlockNumber).toBeLessThanOrEqual(
                    output_block_number
                );
            } else {
                throw new Error(
                    'last_finalized_job is unknown - test setup invalid'
                );
            }
        } finally {
            depositProcessingStatusSubscription.unsubscribe();
        }
    }, 1200000);
});
