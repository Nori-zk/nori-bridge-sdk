import {
    combineLatest,
    distinctUntilChanged,
    interval,
    map,
    switchMap,
} from 'rxjs';
import { getBridgeStateTopic$, getBridgeTimingsTopic$ } from './topics.js';

export const getBridgeStateWithTimings$ = (
    bridgeStateTopic$: ReturnType<typeof getBridgeStateTopic$>,
    bridgeTimingsTopic$: ReturnType<typeof getBridgeTimingsTopic$>
) =>
    // Ensure both topics have fired and merge them into a single observable
    combineLatest([bridgeStateTopic$, bridgeTimingsTopic$]).pipe(
        // Supress bridgeTimingsTopic$ changes until bridgeStateTopic$ changes.
        distinctUntilChanged(
            (prev, curr) => JSON.stringify(prev[0]) === JSON.stringify(curr[0])
        ),
        // Calculate the time remaining
        map(([bridgeState, bridgeTimings]) => {
            // FIXME this mixed casing is awful.
            const { stage_name, elapsed_sec } = bridgeState;
            const expectedDuration = bridgeTimings.extension[stage_name];
            let timeRemaining = expectedDuration - elapsed_sec;
            return { bridgeState, timeRemaining };
        }),
        // Emit bridgeState with time_remaining_sec and elapsed_sec countdown.
        switchMap(({ bridgeState, timeRemaining }) => {
            return interval(1000).pipe(
                map((elapsedSeconds) => ({
                    ...bridgeState,
                    time_remaining_sec: timeRemaining - elapsedSeconds,
                    elapsed_sec: elapsedSeconds,
                }))
            );
        })
    );
