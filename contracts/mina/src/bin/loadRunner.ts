/**
 * loadRunner.ts — Continuous Nori bridge load generator
 *
 * Long-running script that mimics N users repeatedly exercising the
 * bridge (Ethereum lock → Mina mint) to stress-test WSS, worker
 * lifecycle, and the 32-root deposit window on mesa-testnet.
 *
 * Per flow:
 *   - Fresh TokenBridgeWorker (spawned and signalTerminate'd each run).
 *   - Dedicated WSS connection per user (not shared).
 *   - Full flow mirrors minimal-client/src/index.spec.ts.
 *   - Randomised post-canMint delay (see pickClaimDelayUpdates).
 *
 * Minimal env:
 *   ETH_RPC_URL=https://sepolia.infura.io/v3/<key>
 *   LOAD_USER_ETH_PRIV_KEYS=0x<key1>,0x<key2>,0x<key3>
 *   LOAD_USER_MINA_PRIV_KEYS=EKE<key1>,EKE<key2>,EKE<key3>
 *
 * Common optional env:
 *   LOAD_USER_LABELS=alice,bob,carol
 *   LOAD_LOCK_AMOUNTS_ETH=0.0001
 *   LOAD_BASE_TICK_MINUTES=2
 *   LOAD_MAX_CONCURRENT=2
 *   LOAD_MAX_CONCURRENT_COMPILES=5
 *   LOAD_PER_USER_COOLDOWN_MINUTES=5
 *   LOAD_MINT_GATE_TIMEOUT_MINUTES=120
 *   LOAD_LOG_DIR=./logs/loadRunner
 *
 * See parseEnv() for the full list and defaults.
 *
 * Logs under LOAD_LOG_DIR:
 *   loadRunner.log            — scheduler decisions + user state transitions
 *   loadRunner.<label>.log    — per-user stage log
 *   loadRunner.summary.jsonl  — one JSON line per completed flow
 *   stdout                    — everything + live bridge observer
 *
 * Shutdown: SIGINT/SIGTERM = immediate exit (in-flight flows NOT drained).
 */

import 'dotenv/config';
import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { Logger, LogPrinter } from 'esm-iso-logger';
import { Mina, PrivateKey, fetchAccount, type NetworkId } from 'o1js';
import { type BigNumberish, ethers, type TransactionResponse } from 'ethers';
import { NoriTokenBridge__factory } from '@nori-zk/ethereum-token-bridge';
import {
    filter,
    firstValueFrom,
    map,
    race,
    share,
    Subject,
    Subscription,
    takeUntil,
    timer,
    type Observable,
} from 'rxjs';

import { getReconnectingBridgeSocket$ } from '../rx/socket.js';
import {
    getBridgeStateTopic$,
    getBridgeTimingsTopic$,
    getEthStateTopic$,
} from '../rx/topics.js';
import {
    bridgeStatusesKnownEnoughToLockUnsafe,
    canMint,
    getDepositProcessingStatus$,
    readyToComputeMintProof,
} from '../rx/deposit.js';
import { getTokenBridgeWorker } from '../workers/tokenBridgeWorker/node/parent.js';
import { getStagingEnv } from '../tests/testUtils.js';

new LogPrinter('LoadRunner');
const logger = new Logger('LoadRunner');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Hardcoded ETH gas headroom above the lock amount. Sepolia is cheap but RPCs
// sometimes mis-estimate — this keeps us from bouncing on tight balances.
const ETH_GAS_BUFFER_ETH = 0.001;

// LOAD_MINA_MIN_BALANCES — minimum MINA balance required before a flow
// starts. Covers setup (1 MINA new-account fee) + mint + retry headroom.
const MINA_MIN_BALANCE_DEFAULT = 2;

// Contract retains 32 deposit roots. We never lag more than this to keep a
// safety margin below eviction.
const MAX_CLAIM_LAG_UPDATES = 28;

// Conservative per-update wait estimate on mesa. Real cadence varies; this is
// used only to size the claim-lag timeout cap.
const EXPECTED_UPDATE_INTERVAL_MINUTES = 15;
const CLAIM_LAG_MIN_TIMEOUT_MINUTES = 15;
const CLAIM_LAG_MAX_TIMEOUT_MINUTES = 240;

// Pause after signalTerminate so the worker child can exit cleanly.
const WORKER_SETTLE_MS_DEFAULT = 5000;

// Hard cap on readyToComputeMintProof / canMint waits. These gates have no
// upstream timeout, so without a cap a stalled bridge can hang a flow
// forever (holding a worker child + compiled circuits in RAM).
const MINT_GATE_TIMEOUT_MINUTES_DEFAULT = 120;

// Hard cap on the pre-lock `bridgeStatusesKnownEnoughToLockUnsafe` wait.
// Same rationale — no upstream timeout in the helper.
const BRIDGE_READY_TIMEOUT_MINUTES_DEFAULT = 30;

// ---- Env defaults (kept here so tuning is a one-file edit) ----

// LOAD_LOCK_AMOUNTS_ETH — ETH amount per lock. Sepolia is cheap; 0.0001 keeps
// 1000s of runs affordable while staying above the contract's min unit.
const LOCK_AMOUNT_ETH_DEFAULT = 0.0001;

// LOAD_ETH_MIN_BALANCES — floor wallet balance before a flow is allowed to
// run. Acts as operator-mandated headroom beyond a single lock+gas.
const ETH_MIN_BALANCE_DEFAULT = 0.001;

// LOAD_BASE_TICK_MINUTES — scheduler's base period between launch decisions.
const BASE_TICK_MINUTES_DEFAULT = 2;

// LOAD_TICK_JITTER_PCT — ±% random jitter around the base tick so the
// scheduler doesn't align with bridge cadence.
const TICK_JITTER_PCT_DEFAULT = 40;

// LOAD_MAX_CONCURRENT — true global cap on flows in flight at once.
const MAX_CONCURRENT_DEFAULT = 2;

// LOAD_MAX_CONCURRENT_COMPILES — cap on parallel compileAll() invocations
// (CPU-bound, 3–5min each). Independent of max concurrent flows so a flow
// can lock ETH while queued for a compile slot.
const MAX_CONCURRENT_COMPILES_DEFAULT = 5;

// LOAD_PER_USER_COOLDOWN_MINUTES — post-flow ineligibility window per user.
const PER_USER_COOLDOWN_MINUTES_DEFAULT = 5;

// LOAD_MINA_TX_FEE_MINA — fee paid on every Mina tx this script sends.
const MINA_TX_FEE_MINA_DEFAULT = 0.01;

// LOAD_LOG_DIR — where the three log streams are written.
const LOG_DIR_DEFAULT = './logs/loadRunner';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TokenBridgeWorkerInstance = InstanceType<
    ReturnType<typeof getTokenBridgeWorker>
>;

interface UserConfig {
    label: string;
    ethPrivKeyHex: string;
    minaPrivKeyBase58: string;
    scramMsg: string;
    lockAmountEth: number;
    ethMinBalanceEth: number;
    minaMinBalance: number;
}

interface ScriptConfig {
    users: UserConfig[];

    ethRpcUrl: string;
    noriEthBridgeAddressHex: string;
    noriMinaBridgeAddressBase58: string;
    noriTokenBaseAddressBase58: string;
    noriWssUrl: string;
    noriPcsUrl: string;
    minaRpcUrl: string;
    minaArchiveRpcUrl: string;
    minaNetworkId: NetworkId;

    baseTickMs: number;
    tickJitterPct: number;
    maxConcurrent: number;
    maxConcurrentCompiles: number;
    perUserCooldownMs: number;
    workerSettleMs: number;
    mintGateTimeoutMs: number;
    bridgeReadyTimeoutMs: number;
    minaTxFeeNanomina: number;

    logDir: string;
}

type UserStatus = 'IDLE' | 'RUNNING';

interface UserState {
    cfg: UserConfig;
    status: UserStatus;
    nextEligibleAt: number;
    stats: {
        runs: number;
        successes: number;
        failures: number;
        skipped: number;
    };
}

type FlowResult =
    | {
        status: 'success';
        lockTxHash: string;
        mintTxHash: string;
        lockedEth: number;
        mintedBU: string;
        lockDurationMs: number;
        mintDurationMs: number;
        totalDurationMs: number;
        claimDelayUpdates: number;
    }
    | {
        status: 'failure';
        reason: string;
        lockTxHash?: string;
        totalDurationMs: number;
    }
    | {
        status: 'skipped';
        reason: string;
        totalDurationMs: number;
    };

// ---------------------------------------------------------------------------
// Env parsing
// ---------------------------------------------------------------------------

function parseList(envVar: string | undefined): string[] | undefined {
    if (!envVar) return undefined;
    const parts = envVar.split(',').map((s) => s.trim()).filter(Boolean);
    return parts.length > 0 ? parts : undefined;
}

/**
 * Array-or-scalar rule: length 1 broadcasts to all users; length N zips
 * by index; any other length is a fatal config error.
 */
function broadcastOrZip<T>(
    values: T[] | undefined,
    userCount: number,
    fallback: T,
    fieldName: string
): T[] {
    if (!values?.length) return new Array<T>(userCount).fill(fallback);
    if (values.length === 1) return new Array<T>(userCount).fill(values[0]);
    if (values.length !== userCount) {
        throw new Error(
            `${fieldName}: expected length 1 or ${userCount}, got ${values.length}`
        );
    }
    return values;
}

/**
 * Strict numeric env parser. Rejects NaN, infinity, and out-of-range values
 * at startup so the scheduler never silently inherits bad config (zero-delay
 * ticks, deadlocked semaphores, etc).
 */
function parseNumberEnv(
    raw: string | undefined,
    fallback: number,
    name: string,
    opts: { min?: number; max?: number; int?: boolean } = {}
): number {
    if (raw == null || raw === '') return fallback;
    const v = Number(raw);
    if (!Number.isFinite(v)) {
        throw new Error(`${name} must be a finite number (got "${raw}")`);
    }
    if (opts.int && !Number.isInteger(v)) {
        throw new Error(`${name} must be an integer (got ${v})`);
    }
    if (opts.min !== undefined && v < opts.min) {
        throw new Error(`${name} must be >= ${opts.min} (got ${v})`);
    }
    if (opts.max !== undefined && v > opts.max) {
        throw new Error(`${name} must be <= ${opts.max} (got ${v})`);
    }
    return v;
}

/**
 * Formats an ETH amount as a fixed decimal string. `(1e-7).toString()` yields
 * `"1e-7"` which `ethers.parseEther` rejects; this expands to `"0.0000001"`.
 */
function formatEthAmount(n: number): string {
    if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`ETH amount must be positive and finite (got ${n})`);
    }
    if (n >= 1e-6 && !n.toString().includes('e')) return n.toString();
    return n.toFixed(18).replace(/\.?0+$/, '');
}

/**
 * Restricts labels to characters safe in filenames. Keeps the first 32 chars
 * of `[A-Za-z0-9_.-]+` and replaces everything else with `_`.
 */
function sanitizeLabel(label: string): string {
    const safe = label.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 32);
    return safe.length > 0 && safe !== '.' && safe !== '..' ? safe : 'user';
}

function parseEnv(): ScriptConfig {
    const staging = getStagingEnv();

    const ethRpcUrl = process.env.ETH_RPC_URL ?? '';
    if (!/^https?:\/\//.test(ethRpcUrl)) {
        throw new Error(`ETH_RPC_URL missing or invalid (got "${ethRpcUrl}")`);
    }

    const ethPrivKeys = parseList(process.env.LOAD_USER_ETH_PRIV_KEYS);
    const minaPrivKeys = parseList(process.env.LOAD_USER_MINA_PRIV_KEYS);
    if (!ethPrivKeys?.length) {
        throw new Error('LOAD_USER_ETH_PRIV_KEYS is required');
    }
    if (!minaPrivKeys?.length) {
        throw new Error('LOAD_USER_MINA_PRIV_KEYS is required');
    }
    if (ethPrivKeys.length !== minaPrivKeys.length) {
        throw new Error(
            `LOAD_USER_ETH_PRIV_KEYS (${ethPrivKeys.length}) and LOAD_USER_MINA_PRIV_KEYS (${minaPrivKeys.length}) must have equal length`
        );
    }
    if (new Set(ethPrivKeys.map((k) => k.toLowerCase())).size !== ethPrivKeys.length) {
        throw new Error('LOAD_USER_ETH_PRIV_KEYS contains duplicate keys');
    }
    if (new Set(minaPrivKeys).size !== minaPrivKeys.length) {
        throw new Error('LOAD_USER_MINA_PRIV_KEYS contains duplicate keys');
    }

    const userCount = ethPrivKeys.length;
    const rawLabels =
        parseList(process.env.LOAD_USER_LABELS) ??
        Array.from({ length: userCount }, (_, i) => `user${i}`);
    if (rawLabels.length !== userCount) {
        throw new Error(
            `LOAD_USER_LABELS: expected length ${userCount}, got ${rawLabels.length}`
        );
    }
    // Sanitize once here so filenames can embed the label unconditionally.
    const labels = rawLabels.map(sanitizeLabel);
    if (new Set(labels).size !== labels.length) {
        throw new Error(
            `LOAD_USER_LABELS yielded duplicates after sanitization: ${labels.join(', ')}`
        );
    }
    const scramMsgs =
        parseList(process.env.LOAD_USER_SCRAM_MSGS) ??
        labels.map((l) => `NoriZK-${l}`);
    if (scramMsgs.length !== userCount) {
        throw new Error(
            `LOAD_USER_SCRAM_MSGS: expected length ${userCount}, got ${scramMsgs.length}`
        );
    }

    ethPrivKeys.forEach((k, i) => {
        if (!/^0x[a-fA-F0-9]{64}$/.test(k)) {
            throw new Error(
                `LOAD_USER_ETH_PRIV_KEYS[${i}] ("${labels[i]}") must be 0x-prefixed 64 hex chars`
            );
        }
    });
    minaPrivKeys.forEach((k, i) => {
        try {
            PrivateKey.fromBase58(k);
        } catch {
            throw new Error(
                `LOAD_USER_MINA_PRIV_KEYS[${i}] ("${labels[i]}") is not a valid Mina base58 private key`
            );
        }
    });

    const lockAmountsEth = broadcastOrZip(
        parseList(process.env.LOAD_LOCK_AMOUNTS_ETH)?.map(Number),
        userCount,
        LOCK_AMOUNT_ETH_DEFAULT,
        'LOAD_LOCK_AMOUNTS_ETH'
    );
    lockAmountsEth.forEach((amt, i) => {
        if (!Number.isFinite(amt) || amt <= 0) {
            throw new Error(
                `LOAD_LOCK_AMOUNTS_ETH[${i}] ("${labels[i]}") must be positive (got ${amt})`
            );
        }
        try {
            ethers.parseEther(formatEthAmount(amt));
        } catch (err) {
            throw new Error(
                `LOAD_LOCK_AMOUNTS_ETH[${i}] ("${labels[i]}") is not a valid ETH amount: ${String(err)}`
            );
        }
    });
    const ethMinBalances = broadcastOrZip(
        parseList(process.env.LOAD_ETH_MIN_BALANCES)?.map(Number),
        userCount,
        ETH_MIN_BALANCE_DEFAULT,
        'LOAD_ETH_MIN_BALANCES'
    );
    ethMinBalances.forEach((v, i) => {
        if (!Number.isFinite(v) || v < 0) {
            throw new Error(
                `LOAD_ETH_MIN_BALANCES[${i}] ("${labels[i]}") must be >= 0 (got ${v})`
            );
        }
    });
    const minaMinBalances = broadcastOrZip(
        parseList(process.env.LOAD_MINA_MIN_BALANCES)?.map(Number),
        userCount,
        MINA_MIN_BALANCE_DEFAULT,
        'LOAD_MINA_MIN_BALANCES'
    );
    minaMinBalances.forEach((v, i) => {
        if (!Number.isFinite(v) || v < 0) {
            throw new Error(
                `LOAD_MINA_MIN_BALANCES[${i}] ("${labels[i]}") must be >= 0 (got ${v})`
            );
        }
    });

    const users: UserConfig[] = labels.map((label, i) => ({
        label,
        ethPrivKeyHex: ethPrivKeys[i],
        minaPrivKeyBase58: minaPrivKeys[i],
        scramMsg: scramMsgs[i],
        lockAmountEth: lockAmountsEth[i],
        ethMinBalanceEth: ethMinBalances[i],
        minaMinBalance: minaMinBalances[i],
    }));

    // Timing env is in MINUTES — Mina is slow and this script runs for days.
    const baseTickMinutes = parseNumberEnv(
        process.env.LOAD_BASE_TICK_MINUTES,
        BASE_TICK_MINUTES_DEFAULT,
        'LOAD_BASE_TICK_MINUTES',
        { min: 0.01 }
    );
    const perUserCooldownMinutes = parseNumberEnv(
        process.env.LOAD_PER_USER_COOLDOWN_MINUTES,
        PER_USER_COOLDOWN_MINUTES_DEFAULT,
        'LOAD_PER_USER_COOLDOWN_MINUTES',
        { min: 0 }
    );
    const mintGateTimeoutMinutes = parseNumberEnv(
        process.env.LOAD_MINT_GATE_TIMEOUT_MINUTES,
        MINT_GATE_TIMEOUT_MINUTES_DEFAULT,
        'LOAD_MINT_GATE_TIMEOUT_MINUTES',
        { min: 1 }
    );
    const bridgeReadyTimeoutMinutes = parseNumberEnv(
        process.env.LOAD_BRIDGE_READY_TIMEOUT_MINUTES,
        BRIDGE_READY_TIMEOUT_MINUTES_DEFAULT,
        'LOAD_BRIDGE_READY_TIMEOUT_MINUTES',
        { min: 1 }
    );

    return {
        users,
        ethRpcUrl,
        noriEthBridgeAddressHex:
            process.env.NORI_ETH_TOKEN_BRIDGE_ADDRESS ??
            staging.NORI_ETH_TOKEN_BRIDGE_ADDRESS,
        noriMinaBridgeAddressBase58:
            process.env.NORI_MINA_TOKEN_BRIDGE_ADDRESS ??
            staging.NORI_MINA_TOKEN_BRIDGE_ADDRESS,
        noriTokenBaseAddressBase58:
            process.env.NORI_MINA_TOKEN_BASE_ADDRESS ??
            staging.NORI_MINA_TOKEN_BASE_ADDRESS,
        noriWssUrl: process.env.NORI_WSS_URL ?? staging.NORI_WSS_URL,
        noriPcsUrl: process.env.NORI_PCS_URL ?? staging.NORI_PCS_URL,
        minaRpcUrl:
            process.env.MINA_RPC_NETWORK_URL ?? staging.MINA_RPC_NETWORK_URL,
        minaArchiveRpcUrl:
            process.env.MINA_ARCHIVE_RPC_URL ?? staging.MINA_ARCHIVE_RPC_URL,
        minaNetworkId:
            (process.env.MINA_RPC_NETWORK_ID as NetworkId | undefined) ??
            staging.MINA_RPC_NETWORK_ID,
        baseTickMs: baseTickMinutes * 60_000,
        tickJitterPct: parseNumberEnv(
            process.env.LOAD_TICK_JITTER_PCT,
            TICK_JITTER_PCT_DEFAULT,
            'LOAD_TICK_JITTER_PCT',
            { min: 0, max: 200 }
        ),
        maxConcurrent: parseNumberEnv(
            process.env.LOAD_MAX_CONCURRENT,
            MAX_CONCURRENT_DEFAULT,
            'LOAD_MAX_CONCURRENT',
            { min: 1, int: true }
        ),
        maxConcurrentCompiles: parseNumberEnv(
            process.env.LOAD_MAX_CONCURRENT_COMPILES,
            MAX_CONCURRENT_COMPILES_DEFAULT,
            'LOAD_MAX_CONCURRENT_COMPILES',
            { min: 1, int: true }
        ),
        perUserCooldownMs: perUserCooldownMinutes * 60_000,
        workerSettleMs: parseNumberEnv(
            process.env.LOAD_WORKER_SETTLE_MS,
            WORKER_SETTLE_MS_DEFAULT,
            'LOAD_WORKER_SETTLE_MS',
            { min: 0 }
        ),
        mintGateTimeoutMs: mintGateTimeoutMinutes * 60_000,
        bridgeReadyTimeoutMs: bridgeReadyTimeoutMinutes * 60_000,
        minaTxFeeNanomina:
            parseNumberEnv(
                process.env.LOAD_MINA_TX_FEE_MINA,
                MINA_TX_FEE_MINA_DEFAULT,
                'LOAD_MINA_TX_FEE_MINA',
                { min: 0 }
            ) * 1e9,
        logDir: process.env.LOAD_LOG_DIR ?? LOG_DIR_DEFAULT,
    };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

const tsLine = (msg: string) => `[${new Date().toISOString()}] ${msg}`;
const appendLine = (file: string, line: string) => appendFileSync(file, line + '\n');

const formatMs = (ms: number) =>
    ms < 1000 ? `${ms}ms` : ms < 60_000 ? `${(ms / 1000).toFixed(2)}s` : `${(ms / 60_000).toFixed(2)}m`;

function randInt(n: number): number {
    return Math.floor(Math.random() * n);
}

/** Fisher-Yates partial pick. */
function samplePick<T>(arr: T[], k: number): T[] {
    const copy = arr.slice();
    const out: T[] = [];
    for (let i = 0; i < k && copy.length > 0; i++) {
        const idx = randInt(copy.length);
        out.push(copy[idx]);
        copy.splice(idx, 1);
    }
    return out;
}

function jitter(baseMs: number, jitterPct: number): number {
    return Math.max(
        0,
        baseMs + (Math.random() * 2 - 1) * baseMs * (jitterPct / 100)
    );
}

/**
 * Counting semaphore. Used to cap concurrent `compileAll()` invocations:
 * every flow allocates a worker, but compile is CPU-bound and running 20 in
 * parallel saturates the box. Release transfers the slot to the next waiter
 * without decrementing, so the invariant `active ≤ max` always holds.
 */
class Semaphore {
    private queue: Array<() => void> = [];
    private active = 0;
    constructor(private max: number) { }
    private acquire(): Promise<void> {
        if (this.active < this.max) {
            this.active += 1;
            return Promise.resolve();
        }
        return new Promise<void>((resolve) => this.queue.push(resolve));
    }
    private release(): void {
        const next = this.queue.shift();
        if (next) next();
        else this.active -= 1;
    }
    async run<T>(fn: () => Promise<T>): Promise<T> {
        await this.acquire();
        try {
            return await fn();
        } finally {
            this.release();
        }
    }
    get inFlight(): number {
        return this.active;
    }
    get waiting(): number {
        return this.queue.length;
    }
}

/**
 * Wraps a promise in a hard timeout. On fire, runs `onTimeout` (used to
 * cancel the upstream rxjs chain via a Subject) BEFORE rejecting, so the
 * underlying subscription is torn down instead of leaking a live WSS.
 */
async function withCancelableTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    label: string,
    onTimeout: () => void
): Promise<T> {
    let handle: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
        handle = setTimeout(() => {
            onTimeout();
            reject(new Error(`${label} timed out after ${formatMs(timeoutMs)}`));
        }, timeoutMs);
    });
    try {
        return await Promise.race([promise, timeoutPromise]);
    } finally {
        if (handle) clearTimeout(handle);
    }
}

/**
 * Writes to both the per-user log file AND the aggregate scheduler log so an
 * operator tailing either source gets full context.
 */
class UserFileLogger {
    constructor(
        private aggregatePath: string,
        private userPath: string,
        private label: string
    ) { }

    log(msg: string) {
        const line = tsLine(`[${this.label}] ${msg}`);
        appendLine(this.userPath, line);
        appendLine(this.aggregatePath, line);
    }
}

/**
 * Weighted distribution for the randomised claim delay:
 *   70% mint immediately  (common case)
 *   20% lag 1..5 updates  ("user stepped away briefly")
 *   10% lag 5..MAX        ("user claims much later")
 */
function pickClaimDelayUpdates(): number {
    const r = Math.random();
    if (r < 0.7) return 0;
    if (r < 0.9) return 1 + randInt(5);
    return 5 + randInt(MAX_CLAIM_LAG_UPDATES - 5 + 1);
}

/**
 * Waits for N distinct bridge output_slot advances, or for timeoutMs,
 * whichever fires first. Never throws on timeout — better to mint early
 * than miss the window.
 *
 * `timeoutMs` is a stall-guard, NOT an expected-wait estimate. Mesa updates
 * can take 15min+ each — callers should compute a cap that comfortably
 * exceeds normal cadence.
 */
async function waitForBridgeUpdatesOrTimeout(
    bridgeStateTopic$: Observable<{ output_slot: number }>,
    updatesToWaitFor: number,
    timeoutMs: number,
    onUpdate: (count: number, slot: number) => void
): Promise<void> {
    if (updatesToWaitFor <= 0) return;

    // getBridgeStateTopic$ is shareReplay(1): the first emission after
    // subscribing is the CURRENT slot, not a fresh advance. Capture it as the
    // baseline and count only strictly-greater slots so the caller gets the N
    // future advances they asked for.
    let baselineSlot: number | undefined;
    const seen = new Set<number>();
    let count = 0;
    const distinctAdvances$ = bridgeStateTopic$.pipe(
        map((s) => s.output_slot),
        filter((slot) => {
            if (baselineSlot === undefined) {
                baselineSlot = slot;
                seen.add(slot);
                return false;
            }
            if (slot <= baselineSlot || seen.has(slot)) return false;
            seen.add(slot);
            count += 1;
            onUpdate(count, slot);
            return count >= updatesToWaitFor;
        })
    );

    await firstValueFrom(race(distinctAdvances$, timer(timeoutMs)));
}

// ---------------------------------------------------------------------------
// Balance precheck
// ---------------------------------------------------------------------------

interface BalanceCheck {
    ok: boolean;
    reason: string;
    ethBalanceEth: number;
    minaBalance: number;
}

/**
 * Re-read every flow (per directive): balances drift from locks, fees, and
 * external transfers. Requires `Mina.setActiveInstance()` done by caller.
 */
async function checkBalances(
    cfg: UserConfig,
    etherProvider: ethers.JsonRpcProvider
): Promise<BalanceCheck> {
    const ethWallet = new ethers.Wallet(cfg.ethPrivKeyHex, etherProvider);
    const ethBalanceWei = await etherProvider.getBalance(await ethWallet.getAddress());
    const ethBalanceEth = Number(ethers.formatEther(ethBalanceWei));
    // Enforce the operator-configured floor AND the lock+gas requirement.
    // ethMinBalanceEth lets the operator mandate headroom beyond a single run.
    const requiredEth = Math.max(
        cfg.ethMinBalanceEth,
        cfg.lockAmountEth + ETH_GAS_BUFFER_ETH
    );
    if (ethBalanceEth < requiredEth) {
        return {
            ok: false,
            reason: `ETH ${ethBalanceEth.toFixed(6)} < required ${requiredEth.toFixed(6)}`,
            ethBalanceEth,
            minaBalance: -1,
        };
    }

    const minaPubKey = PrivateKey.fromBase58(cfg.minaPrivKeyBase58).toPublicKey();
    await fetchAccount({ publicKey: minaPubKey });
    let minaBalance = 0;
    try {
        minaBalance = Number(Mina.getAccount(minaPubKey).balance.toBigInt()) / 1e9;
    } catch {
        // Account doesn't exist yet — treat as zero balance.
    }

    if (minaBalance < cfg.minaMinBalance) {
        return {
            ok: false,
            reason: `MINA ${minaBalance.toFixed(4)} < required ${cfg.minaMinBalance}`,
            ethBalanceEth,
            minaBalance,
        };
    }

    return { ok: true, reason: '', ethBalanceEth, minaBalance };
}

// ---------------------------------------------------------------------------
// Per-user flow
// ---------------------------------------------------------------------------

/**
 * Full lock → mint pipeline for one user, one run. Mirrors the 14 stages in
 * minimal-client/src/index.spec.ts but with:
 *   - a fresh worker spawned + signalTerminate'd per call
 *   - a per-user WSS (stress-test the socket layer)
 *   - a randomised post-canMint delay
 *   - graceful handling of missed mint windows (logs + returns failure)
 *
 * Ordering invariant: compileAll() must resolve before ANY Mina-touching
 * worker call. We overlap compile with the ETH lock (both are slow) and gate
 * with a single `await tokenBridgeWorkerReady` right after the lock receipt.
 */
async function runUserFlow(
    cfg: UserConfig,
    script: ScriptConfig,
    uLog: UserFileLogger,
    etherProvider: ethers.JsonRpcProvider,
    compileSemaphore: Semaphore
): Promise<FlowResult> {
    const flowStart = Date.now();
    let lockDurationMs = 0;
    let mintDurationMs = 0;

    const subs = new Subscription();
    // Fires on flow teardown or mint-gate timeout. Any observable gated on
    // this via takeUntil completes cleanly, so firstValueFrom subscriptions
    // (inside readyToComputeMintProof / canMint) don't leak a live WSS.
    const cancelMintGate$ = new Subject<void>();
    let tokenBridgeWorker: TokenBridgeWorkerInstance | undefined;

    try {
        uLog.log('Checking on-chain balances...');
        const bal = await checkBalances(cfg, etherProvider);
        uLog.log(`eth=${bal.ethBalanceEth.toFixed(6)} mina=${bal.minaBalance.toFixed(4)}`);
        if (!bal.ok) {
            uLog.log(`SKIP: ${bal.reason}`);
            return {
                status: 'skipped',
                reason: bal.reason,
                totalDurationMs: Date.now() - flowStart,
            };
        }

        uLog.log('Spawning TokenBridgeWorker + queueing compileAll (parallel with lock)...');
        const TokenBridgeWorker = getTokenBridgeWorker();
        tokenBridgeWorker = new TokenBridgeWorker();
        const worker = tokenBridgeWorker;
        await worker.WALLET_setMinaPrivateKey(cfg.minaPrivKeyBase58);
        await worker.minaSetup({
            networkId: script.minaNetworkId,
            mina: script.minaRpcUrl,
            archive: script.minaArchiveRpcUrl,
        });
        uLog.log(
            `compile slots: ${compileSemaphore.inFlight} in-flight, ${compileSemaphore.waiting} waiting`
        );
        const compileStart = Date.now();
        const tokenBridgeWorkerReady = compileSemaphore.run(() =>
            worker.compileAll()
        );
        // Suppress unhandled-rejection if the flow returns (lock revert,
        // receipt missing, outer throw) before awaiting this promise.
        // signalTerminate in finally will propagate a rejection here.
        tokenBridgeWorkerReady.catch((): void => undefined);

        uLog.log(`Opening WSS ${script.noriWssUrl}`);
        const { bridgeSocket$, bridgeSocketConnectionState$ } =
            getReconnectingBridgeSocket$(script.noriWssUrl);
        subs.add(
            bridgeSocketConnectionState$.subscribe({
                next: (state) => uLog.log(`[WS] ${state}`),
                error: (err) => uLog.log(`[WS ERROR] ${String(err)}`),
            })
        );
        const ethStateTopic$ = getEthStateTopic$(bridgeSocket$);
        const bridgeStateTopic$ = getBridgeStateTopic$(bridgeSocket$);
        const bridgeTimingsTopic$ = getBridgeTimingsTopic$(bridgeSocket$);

        // SCRAM sign + codeChallenge don't need compiled circuits.
        const signatureSCRAMBase58 =
            await worker.MOCK_SCRAM_signMessage(cfg.scramMsg);
        const codeChallengeSCRAMStr =
            await worker.SCRAM_createCodeChallenge(signatureSCRAMBase58);
        const codeChallengeSCRAMBigInt = BigInt(codeChallengeSCRAMStr);

        uLog.log('Awaiting sufficient bridge state...');
        // Local cancel subject piped into copies of the topics so the timeout
        // path completes the underlying firstValueFrom inside the helper
        // without affecting the shared topics used downstream.
        const cancelPreLock$ = new Subject<void>();
        try {
            await withCancelableTimeout(
                bridgeStatusesKnownEnoughToLockUnsafe(
                    ethStateTopic$.pipe(takeUntil(cancelPreLock$)),
                    bridgeStateTopic$.pipe(takeUntil(cancelPreLock$)),
                    bridgeTimingsTopic$.pipe(takeUntil(cancelPreLock$))
                ),
                script.bridgeReadyTimeoutMs,
                'bridgeStatusesKnownEnoughToLockUnsafe',
                () => cancelPreLock$.next()
            );
        } finally {
            cancelPreLock$.complete();
        }

        uLog.log(`Locking ${cfg.lockAmountEth} ETH...`);
        const lockStart = Date.now();
        const ethWallet = new ethers.Wallet(cfg.ethPrivKeyHex, etherProvider);
        const contract = NoriTokenBridge__factory.connect(
            script.noriEthBridgeAddressHex,
            ethWallet
        );
        const credentialAttestation: BigNumberish = codeChallengeSCRAMBigInt;
        const depositAmount = ethers.parseEther(formatEthAmount(cfg.lockAmountEth));

        let txResp: TransactionResponse;
        try {
            txResp = await contract.lockTokens(credentialAttestation, {
                value: depositAmount,
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            uLog.log(`LOCK REVERTED: ${msg}`);
            return {
                status: 'failure',
                reason: `lockTokens reverted: ${msg}`,
                totalDurationMs: Date.now() - flowStart,
            };
        }
        uLog.log(`Lock tx ${txResp.hash} sent, awaiting receipt...`);
        const receipt = await txResp.wait();
        if (!receipt) {
            return {
                status: 'failure',
                reason: 'No tx receipt returned',
                lockTxHash: txResp.hash,
                totalDurationMs: Date.now() - flowStart,
            };
        }
        lockDurationMs = Date.now() - lockStart;
        uLog.log(
            `Lock confirmed block=${receipt.blockNumber} in ${formatMs(lockDurationMs)}`
        );

        // GATE: any Mina-touching worker call from here down requires compile.
        const { noriStorageInterfaceVerificationKeySafe } =
            await tokenBridgeWorkerReady;
        uLog.log(`compileAll finished in ${formatMs(Date.now() - compileStart)}`);

        // share() turns the cold pipeline hot so both the logging subscription
        // and the readyToComputeMintProof/canMint awaiters consume the same
        // stream. takeUntil(cancelMintGate$) ensures timeouts and flow
        // teardown complete the observable and free its upstream subscription.
        const depositProcessingStatus$ = getDepositProcessingStatus$(
            receipt.blockNumber,
            ethStateTopic$,
            bridgeStateTopic$,
            bridgeTimingsTopic$
        ).pipe(takeUntil(cancelMintGate$), share());
        subs.add(
            depositProcessingStatus$.subscribe({
                next: (msg) => uLog.log(`[deposit] ${JSON.stringify(msg)}`),
                error: (err) => uLog.log(`[deposit ERROR] ${String(err)}`),
                complete: () => uLog.log('[deposit] processing completed'),
            })
        );

        try {
            await withCancelableTimeout(
                readyToComputeMintProof(depositProcessingStatus$),
                script.mintGateTimeoutMs,
                'readyToComputeMintProof',
                () => cancelMintGate$.next()
            );
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            uLog.log(`readyToComputeMintProof threw: ${msg}`);
            return {
                status: 'failure',
                reason: `missed mint window (pre-proof): ${msg}`,
                lockTxHash: txResp.hash,
                totalDurationMs: Date.now() - flowStart,
            };
        }

        const minaPubKeyBase58 = PrivateKey.fromBase58(cfg.minaPrivKeyBase58)
            .toPublicKey()
            .toBase58();

        const setupRequired = await worker.needsToSetupStorage(
            script.noriMinaBridgeAddressBase58,
            minaPubKeyBase58
        );
        if (setupRequired) {
            uLog.log('Running MOCK_setupStorage...');
            const setupStart = Date.now();
            const { txHash: setupTxHash } =
                await worker.MOCK_setupStorage(
                    minaPubKeyBase58,
                    script.noriMinaBridgeAddressBase58,
                    script.minaTxFeeNanomina,
                    noriStorageInterfaceVerificationKeySafe
                );
            uLog.log(
                `Storage setup tx ${setupTxHash} in ${formatMs(Date.now() - setupStart)}`
            );
        }

        uLog.log('Computing deposit attestation witness...');
        const depositAttestationInput =
            await worker.computeDepositAttestationWitness(
                codeChallengeSCRAMStr,
                receipt.blockNumber,
                script.noriPcsUrl
            );

        try {
            await withCancelableTimeout(
                canMint(depositProcessingStatus$),
                script.mintGateTimeoutMs,
                'canMint',
                () => cancelMintGate$.next()
            );
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            uLog.log(`canMint threw: ${msg}`);
            return {
                status: 'failure',
                reason: `missed mint window (pre-send): ${msg}`,
                lockTxHash: txResp.hash,
                totalDurationMs: Date.now() - flowStart,
            };
        }

        const claimDelayUpdates = pickClaimDelayUpdates();
        if (claimDelayUpdates > 0) {
            const timeoutMin = Math.min(
                CLAIM_LAG_MAX_TIMEOUT_MINUTES,
                Math.max(
                    CLAIM_LAG_MIN_TIMEOUT_MINUTES,
                    claimDelayUpdates * EXPECTED_UPDATE_INTERVAL_MINUTES
                )
            );
            uLog.log(
                `Lagging claim: ${claimDelayUpdates} update(s) or ${timeoutMin}min timeout`
            );
            await waitForBridgeUpdatesOrTimeout(
                bridgeStateTopic$,
                claimDelayUpdates,
                timeoutMin * 60_000,
                (count, slot) =>
                    uLog.log(
                        `[claim-lag] ${count}/${claimDelayUpdates} (slot ${slot})`
                    )
            );
        }

        const needsToFundAccount = await worker.needsToFundAccount(
            script.noriTokenBaseAddressBase58,
            minaPubKeyBase58
        );

        const mintStart = Date.now();
        await worker.MOCK_computeMintProofAndCache(
            minaPubKeyBase58,
            script.noriMinaBridgeAddressBase58,
            depositAttestationInput,
            cfg.scramMsg,
            signatureSCRAMBase58,
            script.minaTxFeeNanomina,
            needsToFundAccount
        );
        const { txHash: mintTxHash } =
            await worker.WALLET_MOCK_signAndSendMintProofCache();
        mintDurationMs = Date.now() - mintStart;
        uLog.log(`Mint tx ${mintTxHash} finalized in ${formatMs(mintDurationMs)}`);

        const mintedSoFar = await worker.mintedSoFar(
            script.noriMinaBridgeAddressBase58,
            minaPubKeyBase58
        );
        const balanceOfUser = await worker.getBalanceOf(
            script.noriTokenBaseAddressBase58,
            minaPubKeyBase58
        );
        uLog.log(`mintedSoFar=${mintedSoFar} balance=${balanceOfUser}`);

        return {
            status: 'success',
            lockTxHash: txResp.hash,
            mintTxHash,
            lockedEth: cfg.lockAmountEth,
            mintedBU: String(mintedSoFar),
            lockDurationMs,
            mintDurationMs,
            totalDurationMs: Date.now() - flowStart,
            claimDelayUpdates,
        };
    } catch (err) {
        const msg = err instanceof Error ? err.stack ?? err.message : String(err);
        uLog.log(`UNCAUGHT: ${msg}`);
        return {
            status: 'failure',
            reason: `uncaught: ${msg.split('\n')[0]}`,
            totalDurationMs: Date.now() - flowStart,
        };
    } finally {
        // Cancel any in-flight mint-gate observable chain before tearing down
        // subscriptions, so orphaned firstValueFrom promises (inside
        // readyToComputeMintProof / canMint) complete instead of leaking.
        cancelMintGate$.next();
        cancelMintGate$.complete();
        subs.unsubscribe();
        try {
            tokenBridgeWorker?.signalTerminate();
        } catch (err) {
            uLog.log(`signalTerminate ignored: ${String(err)}`);
        }
        await new Promise((resolve) => setTimeout(resolve, script.workerSettleMs));
        uLog.log('Teardown complete.');
    }
}

// ---------------------------------------------------------------------------
// Main-thread bridge observer (console-only)
// ---------------------------------------------------------------------------

/**
 * Dedicated WSS that prints live bridge state to stdout (not files) so an
 * operator tailing the process always sees what the bridge is doing, even
 * when no user flow is active.
 */
function startBridgeObserver(wssUrl: string): () => void {
    logger.log(`[observer] connecting to ${wssUrl}`);
    const { bridgeSocket$, bridgeSocketConnectionState$ } =
        getReconnectingBridgeSocket$(wssUrl);
    const subs = new Subscription();

    subs.add(
        bridgeSocketConnectionState$.subscribe({
            next: (state) => logger.log(`[observer WS] ${state}`),
            error: (err) => logger.error(`[observer WS ERROR] ${String(err)}`),
        })
    );
    subs.add(
        getBridgeStateTopic$(bridgeSocket$).subscribe({
            next: (s) =>
                logger.log(
                    `[observer bridge] stage=${s.stage_name} in=${s.input_slot} out=${s.output_slot} elapsed=${s.elapsed_sec}s`
                ),
        })
    );
    subs.add(
        getEthStateTopic$(bridgeSocket$).subscribe({
            next: (s) =>
                logger.log(
                    `[observer eth] finality_slot=${s.latest_finality_slot} block=${s.latest_finality_block_number}`
                ),
        })
    );

    return () => subs.unsubscribe();
}

// ---------------------------------------------------------------------------
// Main / scheduler
// ---------------------------------------------------------------------------

async function main() {
    const script = parseEnv();

    if (!existsSync(script.logDir)) mkdirSync(script.logDir, { recursive: true });
    const aggregatePath = path.join(script.logDir, 'loadRunner.log');
    const summaryPath = path.join(script.logDir, 'loadRunner.summary.jsonl');

    Mina.setActiveInstance(
        Mina.Network({
            networkId: script.minaNetworkId,
            mina: script.minaRpcUrl,
            archive: script.minaArchiveRpcUrl,
        })
    );
    const etherProvider = new ethers.JsonRpcProvider(script.ethRpcUrl);
    const compileSemaphore = new Semaphore(script.maxConcurrentCompiles);

    const userStates: UserState[] = script.users.map((cfg) => ({
        cfg,
        status: 'IDLE',
        nextEligibleAt: 0,
        stats: { runs: 0, successes: 0, failures: 0, skipped: 0 },
    }));

    const banner = [
        '─'.repeat(60),
        `LoadRunner starting @ ${new Date().toISOString()}`,
        `users              : ${userStates.map((u) => u.cfg.label).join(', ')}`,
        `tick               : ${(script.baseTickMs / 60_000).toFixed(1)}min ±${script.tickJitterPct}%`,
        `max concurrent     : ${script.maxConcurrent}`,
        `max concurrent cc  : ${script.maxConcurrentCompiles}`,
        `mint gate timeout  : ${(script.mintGateTimeoutMs / 60_000).toFixed(1)}min`,
        `per-user cooldown  : ${(script.perUserCooldownMs / 60_000).toFixed(1)}min`,
        `eth rpc            : ${script.ethRpcUrl}`,
        `mina rpc           : ${script.minaRpcUrl}`,
        `wss                : ${script.noriWssUrl}`,
        `eth bridge         : ${script.noriEthBridgeAddressHex}`,
        `mina bridge        : ${script.noriMinaBridgeAddressBase58}`,
        `log dir            : ${script.logDir}`,
        '─'.repeat(60),
    ].join('\n');
    logger.log(banner);
    appendLine(aggregatePath, banner);

    const stopObserver = startBridgeObserver(script.noriWssUrl);

    // Immediate shutdown (no drain, per directive). Workers are killed by
    // process termination; on restart balances are re-read for every user.
    let shuttingDown = false;
    const shutdown = (signal: string) => {
        if (shuttingDown) return;
        shuttingDown = true;
        logger.log(`${signal} received — shutting down immediately.`);
        appendLine(aggregatePath, tsLine(`${signal} — immediate shutdown`));
        stopObserver();
        setTimeout(() => process.exit(0), 200);
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // Recursive setTimeout (not setInterval) so slow ticks don't pile up.
    const tick = () => {
        if (shuttingDown) return;
        const now = Date.now();
        const running = userStates.filter((u) => u.status === 'RUNNING').length;
        const cooling = userStates.filter(
            (u) => u.status === 'IDLE' && now < u.nextEligibleAt
        ).length;

        // True global concurrency cap: never exceed script.maxConcurrent
        // across all in-flight flows, not just this tick's picks.
        const slotsAvailable = Math.max(0, script.maxConcurrent - running);
        if (slotsAvailable === 0) {
            logger.log(
                `[tick] cap reached: ${running}/${script.maxConcurrent} running, ${cooling} cooling down`
            );
            return;
        }

        const eligible = userStates.filter(
            (u) => u.status === 'IDLE' && now >= u.nextEligibleAt
        );
        if (eligible.length === 0) {
            logger.log(`[tick] no eligible users (${running} running, ${cooling} cooling down)`);
            return;
        }

        // Random launch size within the available slot budget.
        const desired = 1 + randInt(slotsAvailable);
        const n = Math.min(desired, eligible.length);
        const picked = samplePick(eligible, n);
        logger.log(
            `[tick] picking ${picked.length}/${eligible.length} (${running}→${running + picked.length}/${script.maxConcurrent}): ${picked.map((p) => p.cfg.label).join(', ')}`
        );
        for (const u of picked) startUserFlow(u);
    };

    const startUserFlow = (u: UserState) => {
        u.status = 'RUNNING';
        u.stats.runs += 1;
        const userLogPath = path.join(
            script.logDir,
            `loadRunner.${u.cfg.label}.log`
        );
        const uLog = new UserFileLogger(aggregatePath, userLogPath, u.cfg.label);
        uLog.log(`=== flow #${u.stats.runs} start ===`);

        runUserFlow(u.cfg, script, uLog, etherProvider, compileSemaphore)
            .then((result) => {
                appendLine(
                    summaryPath,
                    JSON.stringify({
                        ts: new Date().toISOString(),
                        user: u.cfg.label,
                        ...result,
                    })
                );
                if (result.status === 'success') u.stats.successes += 1;
                else if (result.status === 'skipped') u.stats.skipped += 1;
                else u.stats.failures += 1;
                uLog.log(
                    `=== flow #${u.stats.runs} ${result.status.toUpperCase()} (${formatMs(result.totalDurationMs)}) ===`
                );
                uLog.log(
                    `stats: runs=${u.stats.runs} ok=${u.stats.successes} fail=${u.stats.failures} skip=${u.stats.skipped}`
                );
            })
            .catch((err) => {
                // runUserFlow has its own catch-all; this is paranoia only.
                appendLine(
                    summaryPath,
                    JSON.stringify({
                        ts: new Date().toISOString(),
                        user: u.cfg.label,
                        status: 'failure',
                        reason: `outer: ${String(err)}`,
                    })
                );
                u.stats.failures += 1;
            })
            .finally(() => {
                u.status = 'IDLE';
                u.nextEligibleAt = Date.now() + script.perUserCooldownMs;
            });
    };

    const scheduleNextTick = () => {
        if (shuttingDown) return;
        setTimeout(() => {
            try {
                tick();
            } catch (err) {
                logger.error(`tick error: ${String(err)}`);
            }
            scheduleNextTick();
        }, jitter(script.baseTickMs, script.tickJitterPct));
    };

    scheduleNextTick();
    logger.log(
        `Scheduler armed. First tick in ~${(script.baseTickMs / 60_000).toFixed(1)}min (±${script.tickJitterPct}%).`
    );
}

main().catch((err) => {
    logger.fatal(`loadRunner bootstrap failed: ${String(err)}`);
    process.exit(1);
});
