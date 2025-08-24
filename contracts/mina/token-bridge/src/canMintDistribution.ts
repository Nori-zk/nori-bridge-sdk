import 'dotenv/config';
import { ethers } from 'ethers';
import {
    getDepositProcessingStatus$,
    BridgeDepositProcessingStatus,
} from './rx/deposit.js';
import { getReconnectingBridgeSocket$ } from './rx/socket.js';
import {
    getBridgeStateTopic$,
    getBridgeTimingsTopic$,
    getEthStateTopic$,
} from './rx/topics.js';
import { filter, firstValueFrom, map, shareReplay, take } from 'rxjs';
import fs from 'fs';
import path from 'path';

const ethRpcUrl = process.env.ETH_RPC_URL;
if (!ethRpcUrl) throw new Error('Provide ETH_RPC_URL in your .env');
const etherProvider = new ethers.JsonRpcProvider(ethRpcUrl);

console.log('Establishing bridge connection and topics.');
const { bridgeSocket$, bridgeSocketConnectionState$ } =
    getReconnectingBridgeSocket$();

// Subscribe to the sockets connection status.
bridgeSocketConnectionState$.subscribe({
    next: (state) => console.log(`[WS] ${state}`),
    error: (state) => console.error(`[WS] ${state}`),
    complete: () => console.log('[WS] Bridge socket connection completed.'),
});

// Retrieve observables for the bridge topics needed and turn them hot.
const ethStateTopic$ = getEthStateTopic$(bridgeSocket$).pipe(shareReplay(1));
const bridgeStateTopic$ = getBridgeStateTopic$(bridgeSocket$).pipe(
    shareReplay(1)
);
const bridgeTimingsTopic$ = getBridgeTimingsTopic$(bridgeSocket$).pipe(
    shareReplay(1)
);
ethStateTopic$.subscribe();
bridgeStateTopic$.subscribe();
bridgeTimingsTopic$.subscribe();

async function getLatestBlockNumber() {
    return etherProvider.getBlockNumber();
}

async function simulateDeposit() {
    // Get the deposit block number (the block in which the deposit occurred)
    const depositBlockNumber = await getLatestBlockNumber();

    console.log(
        `[Sim] Starting deposit simulation for block ${depositBlockNumber} at ${new Date().toISOString()}`
    );

    const depositStatus$ = getDepositProcessingStatus$(
        depositBlockNumber,
        ethStateTopic$,
        bridgeStateTopic$,
        bridgeTimingsTopic$
    ).pipe(shareReplay(1));

    // Track timing data
    const depositStartTime = Date.now();
    let lastSeenStatus: string | null = null;
    let lastSeenStage: string | null = null;

    // timings map structure

    const startTimingsMap: Record<string, any> = {
        WaitingForEthFinality: undefined,
        WaitingForCurrentJobCompletion: {},
        WaitingForPreviousJobCompletion: {},
        ReadyToMint: {},
    };

    const endTimingsMap: Record<string, any> = {
        WaitingForEthFinality: undefined,
        WaitingForCurrentJobCompletion: {},
        WaitingForPreviousJobCompletion: {},
        ReadyToMint: {},
    };

    const timingsMap: Record<string, any> = {
        WaitingForEthFinality: undefined,
        WaitingForCurrentJobCompletion: {},
        WaitingForPreviousJobCompletion: {},
        ReadyToMint: {},
    };

    const sub = depositStatus$.subscribe({
        next: (event) => {
            const now = Date.now();
            const { stage_name, deposit_processing_status } = event;

            if (deposit_processing_status === 'WaitingForEthFinality') {
                if (startTimingsMap['WaitingForEthFinality'] === undefined) {
                    startTimingsMap['WaitingForEthFinality'] = now;
                }
            } else {
                if (!startTimingsMap[deposit_processing_status]) {
                    startTimingsMap[deposit_processing_status] = {};
                }
                if (!startTimingsMap[deposit_processing_status][stage_name]) {
                    startTimingsMap[deposit_processing_status][stage_name] =
                        now;
                }
            }

            if (
                (stage_name !== lastSeenStage ||
                    deposit_processing_status != lastSeenStatus) &&
                lastSeenStatus &&
                lastSeenStage
            ) {
                // if we have any change whatsoever but we have seen a stage / status before
                // update end timings map based on the last seen status / stage
                if (lastSeenStatus === 'WaitingForEthFinality') {
                    endTimingsMap['WaitingForEthFinality'] = now;
                } else {
                    endTimingsMap[lastSeenStatus][lastSeenStage] = now;
                }
            }

            lastSeenStatus = deposit_processing_status;
            lastSeenStage = stage_name;
        },
        error: (err) => console.error('Error in deposit stream:', err),
        complete: () => console.log('Deposit stream completed'),
    });

    try {
        // Wait for ReadyToMint + BridgeHeadJobCreated to unsub
        await firstValueFrom(
            depositStatus$.pipe(
                filter(
                    ({ deposit_processing_status, stage_name }) =>
                        deposit_processing_status ===
                            BridgeDepositProcessingStatus.ReadyToMint &&
                        stage_name === 'BridgeHeadJobCreated'
                ),
                // Only take one event
                take(1),
                // Map to a boolean
                map(() => true)
            )
        );

        sub.unsubscribe();

        const now = Date.now();
        timingsMap.WaitingForEthFinality =
            (endTimingsMap.WaitingForEthFinality -
                startTimingsMap.WaitingForEthFinality) /
            1000;
        const maps = [
            BridgeDepositProcessingStatus.WaitingForCurrentJobCompletion,
            BridgeDepositProcessingStatus.WaitingForPreviousJobCompletion,
            BridgeDepositProcessingStatus.ReadyToMint,
        ];
        maps.forEach((status) => {
            Object.keys(startTimingsMap[status]).forEach((stage) => {
                const startTime = startTimingsMap[status][stage];
                const endTime = endTimingsMap[status][stage] ?? now;
                const elapsedTime = (endTime - startTime) / 1000;
                if (!timingsMap[status]) {
                    timingsMap[status] = {};
                }
                if (!timingsMap[status][stage]) {
                    timingsMap[status][stage] = elapsedTime;
                }
            });
        });

        const overallDepositTimeSec = Math.floor(
            (now - depositStartTime) / 1000
        );

        const result = {
            depositBlockNumber,
            depositStartTime,
            humanReadableDepositStartTime: new Date(
                depositStartTime
            ).toISOString(),
            overallDepositTimeSec,
            timingsMap,
        };

        console.log(
            `[Sim] Finished deposit simulation for block ${depositBlockNumber} at ${new Date().toISOString()} — overall ${overallDepositTimeSec}s`
        );

        console.log('Deposit timings result:', result);
        return result;
    } catch (err) {
        console.error(
            `[Sim] Deposit missed minting opportunity or errored for block ${depositBlockNumber}:`,
            err
        );
        throw err;
    }
}

function collectBridgeTimings(topic$: ReturnType<typeof getBridgeStateTopic$>) {
    const aggregates: Record<string, number[]> = {};
    let started = false;
    let sub: { unsubscribe(): void } | null = null;
    let lastSeenStage: string;
    let timestamp: number | null = null;

    function start() {
        if (started) return;
        started = true;
        sub = topic$.subscribe({
            next: (payload) => {
                const { stage_name: stageName } = payload;
                if (stageName !== lastSeenStage) {
                    if (timestamp === null) {
                        timestamp = Date.now();
                    } else {
                        const elapsed = (Date.now() - timestamp) / 1000;
                        timestamp = Date.now();
                        if (!aggregates[lastSeenStage])
                            aggregates[lastSeenStage] = [];
                        aggregates[lastSeenStage].push(elapsed);
                    }
                }
                lastSeenStage = stageName;
            },
            error: (err) =>
                console.error('[BridgeTimingsCollector] topic error:', err),
        });
    }

    function stop() {
        if (sub) sub.unsubscribe();
        sub = null;
        started = false;
    }

    function getAggregates() {
        return aggregates;
    }

    return { start, stop, getAggregates };
}

function runImmediatelyThenInterval(fn: () => void, ms: number) {
    fn();
    return setInterval(fn, ms);
}

async function runSimulations({
    intervalMs = 5 * 60 * 1000,
    outDir = process.cwd(),
} = {}) {
    const startedAt = Date.now();

    // Trackers for logging
    let finishedCount = 0;

    console.log(
        `[Runner] scheduling simulations, interval ${Math.round(
            intervalMs / 1000
        )}s`
    );

    // Start the bridge timings collector BEFORE scheduling runs so it captures whole window.
    const bridgeCollector = collectBridgeTimings(bridgeStateTopic$);
    bridgeCollector.start();
    console.log('[Runner] bridge timings collector started.');

    // Create an array of results
    const results: { index: number; success?: any; error?: any }[] = [];

    let i = -1;

    function save() {
        const successes: any[] = [];
        const errors: any[] = [];

        // Get current bridge timing aggregates
        const bridgeTimingsAggregates = bridgeCollector.getAggregates();
        for (const s of results) {
            if (s.success) successes.push(s.success);
            else
                errors.push({
                    index: s.index,
                    time: new Date().toISOString(),
                    error: s.error,
                });
        }

        const endedAt = Date.now();

        // Write full results
        const iso = new Date(startedAt).toISOString().replace(/:/g, '-');
        const outFile = path.join(outDir, `deposit_timings_5_${iso}.json`);

        const outPayload = {
            startedAt: new Date(startedAt).toISOString(),
            endedAt: new Date(endedAt).toISOString(),
            runsStarted: i + 1,
            runsCompleted: results.length,
            errors,
            successes,
            bridgeTimingsAggregates,
        };

        fs.writeFileSync(outFile, JSON.stringify(outPayload, null, 2), 'utf8');

        // Print human-readable summaries
        console.log(
            `[Saver] Completed ${successes.length}/${
                i + 1
            } simulations (errors: ${errors.length}).`
        );
        console.log(`[Saver] Full results written to: ${outFile}`);
    }

    // Shutdown
    async function shutdown() {
        // Stop bridge collector
        await bridgeCollector.stop();
        console.log('[Shutdown] Bridge timings collector stopped.');
        console.log('[Shutdown] Saving.');
        save();
        console.log('[Shutdown] Exiting.');
        process.exit(0);
    }

    // Handle ctrl+c
    process.on('SIGINT', async () => {
        console.log('\n[SIGINT] Caught Ctrl+C, shutting down gracefully...');
        await shutdown();
    });

    // Start jobs every intervalMs
    runImmediatelyThenInterval(async () => {
        i++;
        const delay = i * intervalMs;
        const runIndex = i;

        console.log(
            `\n[Runner] Launching simulation ${
                runIndex + 1
            } at ${new Date().toISOString()} (scheduled delay ${Math.round(
                delay / 1000
            )}s).`
        );

        try {
            const res = await simulateDeposit();
            console.log(
                `[Runner] Simulation ${runIndex + 1} finished successfully.`
            );
            results.push({ index: runIndex, success: res });
        } catch (err: any) {
            console.error(
                `[Runner] Simulation ${runIndex + 1} failed (suppressed):`,
                err?.message ?? err
            );
            results.push({ index: runIndex, error: String(err) });
        } finally {
            finishedCount++;
            console.log(
                `[Runner] Completed ${finishedCount} simulations so far.`
            );
        }
    }, intervalMs);

    // Save every minute
    setInterval(() => {
        save();
    }, 60000);
}

async function main() {
    await runSimulations({ intervalMs: 5 * 60 * 1000 });
    await new Promise(() => null);
    process.exit(0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
