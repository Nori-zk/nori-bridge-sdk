/**
 * loadRunner.ts — Continuous Nori bridge load generator
 *
 * Long-running script that mimics N users repeatedly exercising the
 * bridge (Ethereum lock → Mina mint) to stress-test WSS, worker
 * lifecycle, and the 32-root deposit window on mesa-testnet.
 *
 * Per flow:
 *   - Fresh TokenBridgeWorker (spawned and signalTerminate'd each run).
 *   - Dedicated WSS connection per user, opened on that user's first flow
 *     and reused for every later one (see the UserSockets docstring).
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
 *   LOAD_LOCK_AMOUNTS_ETH=0.001
 *   LOAD_BASE_TICK_MINUTES=2
 *   LOAD_MAX_CONCURRENT=2
 *   LOAD_MAX_CONCURRENT_COMPILES=5
 *   LOAD_PER_USER_COOLDOWN_MINUTES=5
 *   LOAD_MINT_GATE_TIMEOUT_MINUTES=120
 *   LOAD_MINA_SEND_TIMEOUT_MINUTES=45
 *   LOAD_MINA_TX_FEE_MINA=0.1
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
import { Field, Mina, PrivateKey, fetchAccount, type NetworkId } from 'o1js';
import { type BigNumberish, ethers, type TransactionResponse } from 'ethers';
import { NoriTokenBridge__factory } from '@nori-zk/ethereum-token-bridge';
import {
    share,
    Subject,
    Subscription,
    takeUntil,
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
import { maxWindow } from '../NoriTokenBridge.const.js';

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

// NoriTokenBridge retains `maxWindow` deposit roots before evicting the
// oldest. We never lag more than this, less a safety margin, so a randomised
// claim delay can't push a deposit past real eviction. Imported rather than
// hardcoded so a contract-side window change lands here too.
//
// Note this is the *contract's* window, which is wider than the window
// rx/deposit.ts uses to declare MissedMintingOpportunity — see the canMint
// catch in runUserFlow for why we don't trust that classification.
const MAX_CLAIM_LAG_UPDATES = maxWindow - 4;

// Stall watchdog for the claim-lag wait: we don't cap TOTAL time, we cap
// silence between advances. A single mesa update can take 15–60min (avg ~30);
// waiting N updates just means summing N of those. What's actually abnormal
// is an extended gap with no advances at all, so we bail if no fresh slot
// lands for this long.
const CLAIM_LAG_STALL_TIMEOUT_MINUTES = 45;

// Pause after signalTerminate so the worker child can exit cleanly.
const WORKER_SETTLE_MS_DEFAULT = 5000;

// Hard cap on readyToComputeMintProof / canMint waits. These gates have no
// upstream timeout, so without a cap a stalled bridge can hang a flow
// forever (holding a worker child + compiled circuits in RAM).
const MINT_GATE_TIMEOUT_MINUTES_DEFAULT = 120;

// Hard cap on the pre-lock `bridgeStatusesKnownEnoughToLockUnsafe` wait.
// Same rationale — no upstream timeout in the helper.
const BRIDGE_READY_TIMEOUT_MINUTES_DEFAULT = 30;

// Mint proofs occasionally land stale (the embedded bridge state has rolled
// past the on-chain window between proof build and tx inclusion). The fix is
// to rebuild the whole proof+send pair and try again — three attempts is
// enough to absorb one or two rolls without giving up on a flow.
const MINT_RETRY_ATTEMPTS = 3;

// Hard cap on a single Mina send (setupStorage, or one mint attempt). Both
// end in `tx.wait()`, which has no timeout of its own — an under-priced or
// dropped tx would otherwise pin a worker child and a concurrency slot for
// the life of the process. Generous enough to cover proving plus several
// Mina blocks; on expiry the mint retry loop rebuilds and tries again.
const MINA_SEND_TIMEOUT_MINUTES_DEFAULT = 45;

// ---- Env defaults (kept here so tuning is a one-file edit) ----

// NoriTokenBridge.MIN_LOCK_AMOUNT_WEI — deposits below this revert with
// BelowMinLockAmount. Sepolia is cheap, so sitting exactly on the minimum
// keeps 1000s of runs affordable.
const MIN_LOCK_AMOUNT_ETH = 0.001;

// NoriTokenBridge.WEI_PER_BRIDGE_UNIT — deposits must be a whole number of
// bridge units, else InvalidBridgeUnitMultiple.
const WEI_PER_BRIDGE_UNIT = 10n ** 12n;

// LOAD_LOCK_AMOUNTS_ETH — ETH amount per lock.
const LOCK_AMOUNT_ETH_DEFAULT = MIN_LOCK_AMOUNT_ETH;

// LOAD_ETH_MIN_BALANCES — floor wallet balance before a flow is allowed to
// run. Acts as operator-mandated headroom beyond a single lock+gas. Default
// covers a few minimum locks plus their gas so a wallet doesn't strand
// mid-campaign.
const ETH_MIN_BALANCE_DEFAULT = 0.005;

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
// Matches the 0.1 the reference e2e flow (minimal-client/src/index.spec.ts)
// uses for both setupStorage and mint. Both sends block on tx.wait(), so an
// under-priced tx costs a whole flow's worth of stall rather than a retry.
const MINA_TX_FEE_MINA_DEFAULT = 0.1;

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
    noriTokenBaseTokenId: string;
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
    minaSendTimeoutMs: number;
    minaTxFeeNanomina: number;

    logDir: string;
}

type UserStatus = 'IDLE' | 'RUNNING';

/**
 * One observed stage transition. `startedAt` is the local timestamp when we
 * first saw this `stage_name`; `finishedAt` is set when the next stage_name
 * arrives. `serverElapsedSec` / `etaSec` are the server's self-reported
 * numbers on the last message for this stage — elapsed is real, eta is a
 * prediction from prior runs.
 */
interface StageRec {
    name: string;
    startedAt: number;
    finishedAt?: number;
    serverElapsedSec: number;
    etaSec?: number;
    depStatus?: string;
    inSlot?: number;
    outSlot?: number;
}

interface PaneBalances {
    eth: number;
    mina: number;
    nEth: number | null;
    fetchedAt: number;
    error?: string;
}

// One observed value of deposit_processing_status (e.g.
// WaitingForEthFinality → WaitingForPreviousJobCompletion → ...).
// Bridge stage_name events only carry meaning while we're inside
// WaitingForCurrentJobCompletion — see PHASE_LABELS for the user-facing copy.
interface PhaseRec {
    status: string;
    startedAt: number;
    finishedAt?: number;
}

/**
 * A user's bridge socket and the three topics derived from it.
 *
 * `ReconnectingWebSocketSubject` connects in its constructor and reconnects on
 * every close for the life of the process; downstream unsubscribes don't close
 * it and there is no public teardown. Opening one per flow would therefore
 * strand a live socket plus its 3s heartbeat on every run, so each user opens
 * exactly one on their first flow and reuses it thereafter — N connections
 * total rather than N × runs.
 *
 * Reuse also helps the flow itself: the topics are `shareReplay(1)` with no
 * ref-counting, so later flows see current bridge state immediately instead of
 * waiting for the next frame.
 */
interface UserSockets {
    connectionState$: ReturnType<
        typeof getReconnectingBridgeSocket$
    >['bridgeSocketConnectionState$'];
    ethStateTopic$: ReturnType<typeof getEthStateTopic$>;
    bridgeStateTopic$: ReturnType<typeof getBridgeStateTopic$>;
    bridgeTimingsTopic$: ReturnType<typeof getBridgeTimingsTopic$>;
}

interface UserState {
    cfg: UserConfig;
    status: UserStatus;
    sockets?: UserSockets;
    nextEligibleAt: number;
    stats: {
        runs: number;
        successes: number;
        failures: number;
        skipped: number;
    };
    // TUI state: populated incrementally from runUserFlow + TUI side.
    flowStartedAt?: number;
    currentStage?: string;
    stages: StageRec[];
    phaseEvents: PhaseRec[];
    lastDepStatus?: string;
    lastSlots?: { inSlot: number; outSlot: number };
    lastDepositBlock?: number;
    balances?: PaneBalances;
    balancesLoading?: boolean;
}

/**
 * Cross-flow drain signal. `requested` flips true when graceful shutdown is
 * triggered ('g' key); `signal$` fires once at the same moment so flows
 * already inside a wait can abort. New waits should check `requested` first.
 */
type DrainSignal = {
    requested: boolean;
    signal$: Subject<void>;
};

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
        let wei: bigint;
        try {
            wei = ethers.parseEther(formatEthAmount(amt));
        } catch (err) {
            throw new Error(
                `LOAD_LOCK_AMOUNTS_ETH[${i}] ("${labels[i]}") is not a valid ETH amount: ${String(err)}`
            );
        }
        if (amt < MIN_LOCK_AMOUNT_ETH) {
            throw new Error(
                `LOAD_LOCK_AMOUNTS_ETH[${i}] ("${labels[i]}") = ${amt} ETH is below the contract minimum ` +
                `of ${MIN_LOCK_AMOUNT_ETH} ETH; lockTokens would revert with BelowMinLockAmount`
            );
        }
        if (wei % WEI_PER_BRIDGE_UNIT !== 0n) {
            throw new Error(
                `LOAD_LOCK_AMOUNTS_ETH[${i}] ("${labels[i]}") = ${amt} ETH is not a whole multiple of ` +
                `${ethers.formatEther(WEI_PER_BRIDGE_UNIT)} ETH (one bridge unit); ` +
                `lockTokens would revert with InvalidBridgeUnitMultiple`
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
    const minaSendTimeoutMinutes = parseNumberEnv(
        process.env.LOAD_MINA_SEND_TIMEOUT_MINUTES,
        MINA_SEND_TIMEOUT_MINUTES_DEFAULT,
        'LOAD_MINA_SEND_TIMEOUT_MINUTES',
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
        noriTokenBaseTokenId:
            process.env.NORI_MINA_TOKEN_BASE_TOKEN_ID ??
            staging.NORI_MINA_TOKEN_BASE_TOKEN_ID,
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
        minaSendTimeoutMs: minaSendTimeoutMinutes * 60_000,
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
 * Raised only by `withCancelableTimeout` when its own deadline expires.
 * Distinguishable from anything the wrapped work threw, which is what lets
 * the mint gates tell "we waited too long" apart from "the bridge stream said
 * something we don't trust".
 */
class FlowTimeoutError extends Error {
    constructor(label: string, timeoutMs: number) {
        super(`${label} timed out after ${formatMs(timeoutMs)}`);
        this.name = 'FlowTimeoutError';
    }
}

/**
 * Wraps a promise in a hard timeout. On fire, runs `onTimeout` (used to
 * cancel the upstream rxjs chain via a Subject) BEFORE rejecting, so the
 * underlying subscription is torn down instead of leaking a live WSS.
 *
 * Omit `onTimeout` for work with nothing to cancel — a worker RPC call, say,
 * where the losing promise is abandoned and the worker child is killed by the
 * flow's `signalTerminate`.
 */
async function withCancelableTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    label: string,
    onTimeout?: () => void
): Promise<T> {
    let handle: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
        handle = setTimeout(() => {
            onTimeout?.();
            reject(new FlowTimeoutError(label, timeoutMs));
        }, timeoutMs);
    });
    try {
        return await Promise.race([promise, timeoutPromise]);
    } finally {
        if (handle) clearTimeout(handle);
    }
}

// Shared split-screen buffers. The TTY UI (below) redraws these, and the
// per-user + scheduler loggers push through them so the right pane reflects
// all flow activity regardless of who emitted it.
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_RE_INLINE = /\x1b\[[0-9;?]*[a-zA-Z]/g;
const stripAnsi = (s: string) => s.replace(ANSI_ESCAPE_RE_INLINE, '');
class LogRing {
    private buf: string[] = [];
    constructor(private capacity: number) { }
    push(line: string) {
        this.buf.push(line);
        if (this.buf.length > this.capacity) {
            this.buf.splice(0, this.buf.length - this.capacity);
        }
    }
    tail(n: number): string[] {
        return this.buf.slice(Math.max(0, this.buf.length - n));
    }
}
const logRing = new LogRing(500);

/**
 * Consecutive-duplicate suppressor. Only collapses the bridge's `[deposit]`
 * stream, which fires on every WSS frame during mint processing — keying on
 * the embedded `stage_name` field so we get one line per stage transition.
 * Every other log passes through unchanged so compile progress, lock/mint
 * timing, WS state transitions, etc. all appear verbatim.
 */
class StageDedup {
    private lastDepositStage = '';
    shouldEmit(msg: string): boolean {
        const deposit = msg.match(/\[deposit\]\s*(.*)$/);
        if (!deposit) return true;
        const stageMatch = deposit[1].match(/"stage_name"\s*:\s*"([^"]+)"/);
        const key = stageMatch ? stageMatch[1] : deposit[1];
        if (key === this.lastDepositStage) return false;
        this.lastDepositStage = key;
        return true;
    }
}

/**
 * Writes to the per-user log file, the aggregate scheduler log, AND mirrors
 * to the split-screen ring so the right pane reflects flow activity. Each
 * destination has its own dedup state to keep [deposit] chatter bounded
 * without hiding any other messages.
 */
class UserFileLogger {
    private userDedup = new StageDedup();
    private ringDedup = new StageDedup();
    constructor(
        private aggregatePath: string,
        private userPath: string,
        private label: string,
        private aggregateDedup: StageDedup
    ) { }

    log(msg: string) {
        const prefixed = `[${this.label}] ${msg}`;
        const line = tsLine(prefixed);
        if (this.userDedup.shouldEmit(prefixed)) {
            appendLine(this.userPath, line);
        }
        if (this.aggregateDedup.shouldEmit(prefixed)) {
            appendLine(this.aggregatePath, line);
        }
        if (this.ringDedup.shouldEmit(prefixed)) {
            logRing.push(stripAnsi(line));
        }
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
 * Waits for N distinct bridge output_slot advances, with an inactivity
 * watchdog: bails if no new advance is seen for `stallTimeoutMs`. Never
 * throws — on stall we resolve with `completed=false` so the caller can
 * decide (typically still try to mint; the on-chain call is authoritative).
 *
 * The first emission of `bridgeStateTopic$` is the replayed current slot, not
 * a fresh advance — we capture it as a baseline and count only strictly
 * greater slots.
 */
async function waitForBridgeUpdatesOrStall(
    bridgeStateTopic$: Observable<{ output_slot: number }>,
    updatesToWaitFor: number,
    stallTimeoutMs: number,
    onUpdate: (count: number, slot: number) => void,
    abort$?: Observable<unknown>
): Promise<{ completed: boolean; reason?: string; received: number }> {
    if (updatesToWaitFor <= 0) return { completed: true, received: 0 };

    return new Promise((resolve) => {
        let baselineSlot: number | undefined;
        const seen = new Set<number>();
        let count = 0;
        let stallTimer: NodeJS.Timeout | undefined;
        let abortSub: Subscription | undefined;
        const done = (completed: boolean, reason?: string) => {
            if (stallTimer) clearTimeout(stallTimer);
            abortSub?.unsubscribe();
            sub.unsubscribe();
            resolve({ completed, reason, received: count });
        };
        const armStall = () => {
            if (stallTimer) clearTimeout(stallTimer);
            stallTimer = setTimeout(
                () =>
                    done(
                        false,
                        `no advance in ${Math.round(stallTimeoutMs / 60_000)}min`
                    ),
                stallTimeoutMs
            );
        };
        armStall();
        if (abort$) {
            abortSub = abort$.subscribe({
                next: () => done(false, 'aborted (drain)'),
            });
        }
        const sub = bridgeStateTopic$.subscribe({
            next: (s) => {
                const slot = s.output_slot;
                if (baselineSlot === undefined) {
                    baselineSlot = slot;
                    seen.add(slot);
                    return;
                }
                if (slot <= baselineSlot || seen.has(slot)) return;
                seen.add(slot);
                count += 1;
                onUpdate(count, slot);
                if (count >= updatesToWaitFor) done(true);
                else armStall();
            },
            error: () => done(false, 'stream error'),
            complete: () => done(false, 'stream completed'),
        });
    });
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

/**
 * Read ETH, MINA, and nETH balances for the TUI side panel. Never throws —
 * failures are recorded as NaN with an `error` note so the pane can still
 * render. Intentionally fetches without a worker: nETH is read via
 * `Mina.getAccount(..., tokenId)` directly so we don't spin up a worker for
 * every IDLE user.
 */
async function fetchPaneBalances(
    u: UserState,
    script: ScriptConfig,
    etherProvider: ethers.JsonRpcProvider
): Promise<void> {
    u.balancesLoading = true;
    try {
        const ethWallet = new ethers.Wallet(u.cfg.ethPrivKeyHex, etherProvider);
        const ethAddr = await ethWallet.getAddress();
        const ethWei = await etherProvider.getBalance(ethAddr);
        const eth = Number(ethers.formatEther(ethWei));

        const minaPubKey = PrivateKey.fromBase58(
            u.cfg.minaPrivKeyBase58
        ).toPublicKey();
        await fetchAccount({ publicKey: minaPubKey });
        let mina = 0;
        try {
            mina = Number(Mina.getAccount(minaPubKey).balance.toBigInt()) / 1e9;
        } catch { /* account doesn't exist yet */ }

        let nEth: number | null = null;
        try {
            const fetched = await fetchAccount({ publicKey: minaPubKey, tokenId: Field.fromValue(script.noriTokenBaseTokenId) });
            nEth =
                Number(
                    fetched.account.balance.toBigInt()
                )
                / 1e6;
        } catch {
            nEth = 0;
        }

        u.balances = { eth, mina, nEth, fetchedAt: Date.now() };
    } catch (err) {
        u.balances = {
            eth: NaN,
            mina: NaN,
            nEth: null,
            fetchedAt: Date.now(),
            error: String(err).slice(0, 60),
        };
    } finally {
        u.balancesLoading = false;
    }
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
    userState: UserState,
    script: ScriptConfig,
    uLog: UserFileLogger,
    etherProvider: ethers.JsonRpcProvider,
    compileSemaphore: Semaphore,
    drainSignal: DrainSignal,
    onStageChange?: (u: UserState) => void
): Promise<FlowResult> {
    const cfg = userState.cfg;
    // Wall-clock start of the whole runUserFlow call; used internally for
    // measuring overall duration in FlowResult / log output.
    const flowStart = Date.now();
    // userState.flowStartedAt is the *user-visible* timer and is intentionally
    // delayed until after lockTokens() returns — compile + bridge-state-wait
    // happen before the deposit is actually on-chain, and we don't want that
    // pre-amble to inflate the per-flow elapsed shown in the TUI.
    userState.flowStartedAt = undefined;
    userState.stages = [];
    userState.phaseEvents = [];
    userState.currentStage = undefined;
    userState.lastDepStatus = undefined;
    userState.lastSlots = undefined;
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
            worker.compileMinterDepsNoCache(true)
        );
        // Suppress unhandled-rejection if the flow returns (lock revert,
        // receipt missing, outer throw) before awaiting this promise.
        // signalTerminate in finally will propagate a rejection here.
        tokenBridgeWorkerReady.catch((): void => undefined);

        // Opened once per user and reused — see UserSockets for why this is
        // not per-flow. The state subscription stays per-flow so each flow's
        // log gets its own [WS] trail; connectionState$ replays the current
        // state on subscribe.
        if (!userState.sockets) {
            uLog.log(`Opening WSS ${script.noriWssUrl}`);
            const { bridgeSocket$, bridgeSocketConnectionState$ } =
                getReconnectingBridgeSocket$(script.noriWssUrl);
            userState.sockets = {
                connectionState$: bridgeSocketConnectionState$,
                ethStateTopic$: getEthStateTopic$(bridgeSocket$),
                bridgeStateTopic$: getBridgeStateTopic$(bridgeSocket$),
                bridgeTimingsTopic$: getBridgeTimingsTopic$(bridgeSocket$),
            };
        } else {
            uLog.log('Reusing this user\'s WSS connection');
        }
        const { ethStateTopic$, bridgeStateTopic$, bridgeTimingsTopic$ } =
            userState.sockets;
        subs.add(
            userState.sockets.connectionState$.subscribe({
                next: (state) => uLog.log(`[WS] ${state}`),
                error: (err) => uLog.log(`[WS ERROR] ${String(err)}`),
            })
        );

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
        // Real timer starts here: the deposit has been broadcast.
        userState.flowStartedAt = Date.now();
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
                next: (msg) => {
                    uLog.log(`[deposit] ${JSON.stringify(msg)}`);
                    // Mirror to UserState so the TUI can render pipeline
                    // + balances without scraping the log ring.
                    const m = msg as unknown as {
                        stage_name?: string;
                        elapsed_sec?: number;
                        time_remaining_sec?: number;
                        deposit_processing_status?: string;
                        input_slot?: number;
                        output_slot?: number;
                        deposit_block_number?: number;
                    };
                    if (!m.stage_name) return;
                    const now = Date.now();
                    const stageChanged =
                        userState.currentStage !== m.stage_name;
                    if (stageChanged) {
                        const prev =
                            userState.stages[userState.stages.length - 1];
                        if (prev && !prev.finishedAt) prev.finishedAt = now;
                        userState.stages.push({
                            name: m.stage_name,
                            startedAt: now,
                            serverElapsedSec: m.elapsed_sec ?? 0,
                            etaSec: m.time_remaining_sec,
                            depStatus: m.deposit_processing_status,
                            inSlot: m.input_slot,
                            outSlot: m.output_slot,
                        });
                        userState.currentStage = m.stage_name;
                    } else {
                        const cur =
                            userState.stages[userState.stages.length - 1];
                        if (cur) {
                            cur.serverElapsedSec = m.elapsed_sec ?? cur.serverElapsedSec;
                            cur.etaSec = m.time_remaining_sec ?? cur.etaSec;
                            cur.depStatus = m.deposit_processing_status;
                            cur.inSlot = m.input_slot;
                            cur.outSlot = m.output_slot;
                        }
                    }
                    // Track high-level phase transitions independently of
                    // bridge stages: WaitingForEthFinality →
                    // WaitingForPreviousJobCompletion →
                    // WaitingForCurrentJobCompletion → ReadyToMint.
                    const newStatus = m.deposit_processing_status;
                    if (newStatus && newStatus !== userState.lastDepStatus) {
                        const prevPhase =
                            userState.phaseEvents[
                                userState.phaseEvents.length - 1
                            ];
                        if (prevPhase && !prevPhase.finishedAt) {
                            prevPhase.finishedAt = now;
                        }
                        userState.phaseEvents.push({
                            status: newStatus,
                            startedAt: now,
                        });
                    }
                    userState.lastDepStatus = newStatus;
                    if (m.input_slot !== undefined && m.output_slot !== undefined) {
                        userState.lastSlots = {
                            inSlot: m.input_slot,
                            outSlot: m.output_slot,
                        };
                    }
                    userState.lastDepositBlock = m.deposit_block_number;
                    if (stageChanged) onStageChange?.(userState);
                },
                error: (err) => uLog.log(`[deposit ERROR] ${String(err)}`),
                complete: () => {
                    // The upstream observable completes on MissedMintingOpportunity
                    // (a narrow-window heuristic) OR teardown via cancelMintGate$.
                    // Neither implies the on-chain mint will fail, so don't
                    // phrase this as terminal.
                    uLog.log('[deposit] WSS stream ended (informational only)');
                    const last = userState.stages[userState.stages.length - 1];
                    if (last && !last.finishedAt) last.finishedAt = Date.now();
                },
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
            // Same rationale as the canMint catch below. Only our own deadline
            // bails; anything the rx layer raised is advisory.
            if (err instanceof FlowTimeoutError) {
                uLog.log(`readyToComputeMintProof timed out: ${err.message}`);
                return {
                    status: 'failure',
                    reason: `mint gate timeout (pre-proof): ${err.message}`,
                    lockTxHash: txResp.hash,
                    totalDurationMs: Date.now() - flowStart,
                };
            }
            const msg = err instanceof Error ? err.message : String(err);
            uLog.log(
                `readyToComputeMintProof reports not-ready (advisory): ${msg} — attempting mint anyway`
            );
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
            // MOCK_setupStorage ends in tx.wait(), which has no timeout of its
            // own — cap it so an unincluded tx can't pin the worker forever.
            const { txHash: setupTxHash } = await withCancelableTimeout(
                worker.MOCK_setupStorage(
                    minaPubKeyBase58,
                    script.noriMinaBridgeAddressBase58,
                    script.minaTxFeeNanomina,
                    noriStorageInterfaceVerificationKeySafe
                ),
                script.minaSendTimeoutMs,
                'MOCK_setupStorage'
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
                script.noriEthBridgeAddressHex,
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
            // rx/deposit.ts classifies MissedMintingOpportunity from a window
            // heuristic that is narrower than the contract's real retention
            // (NoriTokenBridge keeps `maxWindow` deposit roots), so it calls
            // "missed" well before the root is actually evicted. It also
            // completes the stream when it does, which makes later gate
            // subscriptions fail in their own ways. None of that is
            // authoritative — the on-chain mint is, and we've already paid for
            // compile + setup + attestation witness. So bail only on our own
            // deadline; treat every other error here as advisory and try.
            if (err instanceof FlowTimeoutError) {
                uLog.log(`canMint timed out: ${err.message}`);
                return {
                    status: 'failure',
                    reason: `mint gate timeout (pre-send): ${err.message}`,
                    lockTxHash: txResp.hash,
                    totalDurationMs: Date.now() - flowStart,
                };
            }
            const msg = err instanceof Error ? err.message : String(err);
            uLog.log(
                `canMint reports not-ready (advisory): ${msg} — attempting mint anyway`
            );
        }

        const claimDelayUpdates = pickClaimDelayUpdates();
        if (claimDelayUpdates > 0) {
            if (drainSignal.requested) {
                uLog.log(
                    `[claim-lag] drain requested — skipping ${claimDelayUpdates}-update lag, minting now`
                );
            } else {
                uLog.log(
                    `Lagging claim: ${claimDelayUpdates} update(s) (stall watchdog: ${CLAIM_LAG_STALL_TIMEOUT_MINUTES}min)`
                );
                const lagResult = await waitForBridgeUpdatesOrStall(
                    bridgeStateTopic$,
                    claimDelayUpdates,
                    CLAIM_LAG_STALL_TIMEOUT_MINUTES * 60_000,
                    (count, slot) =>
                        uLog.log(
                            `[claim-lag] ${count}/${claimDelayUpdates} (slot ${slot})`
                        ),
                    drainSignal.signal$
                );
                if (!lagResult.completed) {
                    if (lagResult.reason === 'aborted (drain)') {
                        uLog.log(
                            `[claim-lag] drain — minting immediately after ${lagResult.received}/${claimDelayUpdates}`
                        );
                    } else {
                        uLog.log(
                            `[claim-lag] giving up after ${lagResult.received}/${claimDelayUpdates} (${lagResult.reason}) — attempting mint anyway`
                        );
                    }
                }
            }
        }

        // Mint can fail if the proof embeds bridge state that has rolled
        // forward by the time the tx is included. Rebuild the whole
        // proof+send pair on each attempt — both `needsToFundAccount` and
        // the proof itself are re-derived from current state, so a stale
        // one-shot becomes a fresh retry.
        const mintStart = Date.now();
        let mintTxHash: string | undefined;
        let lastMintErr: unknown;
        for (let attempt = 1; attempt <= MINT_RETRY_ATTEMPTS; attempt++) {
            try {
                const needsToFundNow = await worker.needsToFundAccount(
                    script.noriTokenBaseAddressBase58,
                    minaPubKeyBase58
                );
                uLog.log(
                    `Mint attempt ${attempt}/${MINT_RETRY_ATTEMPTS}: building proof (needsToFund=${needsToFundNow})...`
                );
                await worker.MOCK_computeMintProofAndCache(
                    minaPubKeyBase58,
                    script.noriMinaBridgeAddressBase58,
                    depositAttestationInput,
                    cfg.scramMsg,
                    signatureSCRAMBase58,
                    script.minaTxFeeNanomina,
                    needsToFundNow
                );
                // Ends in tx.wait(); cap it as for setup above.
                const sent = await withCancelableTimeout(
                    worker.WALLET_MOCK_signAndSendMintProofCache(),
                    script.minaSendTimeoutMs,
                    'WALLET_MOCK_signAndSendMintProofCache'
                );
                mintTxHash = sent.txHash;
                uLog.log(
                    `Mint attempt ${attempt} succeeded: tx ${mintTxHash}`
                );
                break;
            } catch (err) {
                lastMintErr = err;
                const msg = err instanceof Error ? err.message : String(err);
                uLog.log(
                    `Mint attempt ${attempt}/${MINT_RETRY_ATTEMPTS} failed: ${msg}`
                );
                // A timeout means the worker is still proving or still waiting
                // on a tx we abandoned. Retrying on top of that races two
                // sends from one key, so stop and let teardown kill the child.
                if (err instanceof FlowTimeoutError) {
                    uLog.log('Mint timed out — not retrying on a busy worker.');
                    break;
                }
            }
        }
        if (!mintTxHash) {
            const reason =
                lastMintErr instanceof Error
                    ? lastMintErr.message
                    : String(lastMintErr);
            return {
                status: 'failure',
                reason: `mint failed after ${MINT_RETRY_ATTEMPTS} attempts: ${reason}`,
                lockTxHash: txResp.hash,
                totalDurationMs: Date.now() - flowStart,
            };
        }
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

export type ObserverSnapshot = {
    wsState: string;
    latestBridge: {
        stage_name: string;
        input_slot: number | string;
        output_slot: number | string;
        elapsed_sec: number | string;
    } | null;
    latestEth: {
        latest_finality_slot: number | string;
        latest_finality_block_number: number | string;
    } | null;
    lastBridgeAt: number;
    lastEthAt: number;
};

/**
 * Dedicated WSS that tracks live bridge state. Still logs every emission so a
 * tailing operator sees raw events, but also exposes a getter so the scheduler
 * can redraw a live status banner on a fixed cadence (between bridge frames).
 */
function startBridgeObserver(wssUrl: string): {
    stop: () => void;
    snapshot: () => ObserverSnapshot;
} {
    logger.log(`[observer] connecting to ${wssUrl}`);
    const { bridgeSocket$, bridgeSocketConnectionState$ } =
        getReconnectingBridgeSocket$(wssUrl);
    const subs = new Subscription();

    const snap: ObserverSnapshot = {
        wsState: 'connecting',
        latestBridge: null,
        latestEth: null,
        lastBridgeAt: 0,
        lastEthAt: 0,
    };

    subs.add(
        bridgeSocketConnectionState$.subscribe({
            next: (state) => {
                snap.wsState = state;
            },
            error: (err) => logger.error(`[observer WS ERROR] ${String(err)}`),
        })
    );
    subs.add(
        getBridgeStateTopic$(bridgeSocket$).subscribe({
            next: (s) => {
                snap.latestBridge = s;
                snap.lastBridgeAt = Date.now();
            },
        })
    );
    subs.add(
        getEthStateTopic$(bridgeSocket$).subscribe({
            next: (s) => {
                snap.latestEth = s;
                snap.lastEthAt = Date.now();
            },
        })
    );

    return {
        stop: () => subs.unsubscribe(),
        snapshot: () => snap,
    };
}

// ---------------------------------------------------------------------------
// Main / scheduler
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Split-screen terminal UI: stdout hijack + ring buffer + full redraw
// ---------------------------------------------------------------------------

const visibleLen = (s: string) => stripAnsi(s).length;
const padRightVisible = (s: string, w: number) => {
    const v = visibleLen(s);
    return v >= w ? s : s + ' '.repeat(w - v);
};

const originalStdoutWrite = process.stdout.write.bind(process.stdout);
let bypassStdout = false;
let stdoutLineBuffer = '';

function installStdoutHijack() {
    (process.stdout as unknown as { write: unknown }).write = (
        chunk: string | Uint8Array,
        ...rest: unknown[]
    ): boolean => {
        if (bypassStdout) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (originalStdoutWrite as any)(chunk, ...rest);
        }
        const str =
            typeof chunk === 'string'
                ? chunk
                : Buffer.from(chunk).toString('utf8');
        stdoutLineBuffer += str;
        let nl = stdoutLineBuffer.indexOf('\n');
        while (nl >= 0) {
            const line = stdoutLineBuffer.slice(0, nl);
            stdoutLineBuffer = stdoutLineBuffer.slice(nl + 1);
            if (line.length > 0) logRing.push(stripAnsi(line));
            nl = stdoutLineBuffer.indexOf('\n');
        }
        return true;
    };
}

function restoreStdout() {
    (process.stdout as unknown as { write: unknown }).write =
        originalStdoutWrite as unknown;
}

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
    const aggregateDedup = new StageDedup();

    const userStates: UserState[] = script.users.map((cfg) => ({
        cfg,
        status: 'IDLE',
        nextEligibleAt: 0,
        stats: { runs: 0, successes: 0, failures: 0, skipped: 0 },
        stages: [] as StageRec[],
        phaseEvents: [] as PhaseRec[],
    }));

    const banner = [
        '─'.repeat(60),
        `LoadRunner starting @ ${new Date().toISOString()}`,
        `users              : ${userStates.map((u) => u.cfg.label).join(', ')}`,
        `tick               : ${(script.baseTickMs / 60_000).toFixed(1)}min ±${script.tickJitterPct}%`,
        `max concurrent     : ${script.maxConcurrent}`,
        `max concurrent cc  : ${script.maxConcurrentCompiles}`,
        `mint gate timeout  : ${(script.mintGateTimeoutMs / 60_000).toFixed(1)}min`,
        `mina send timeout  : ${(script.minaSendTimeoutMs / 60_000).toFixed(1)}min`,
        `per-user cooldown  : ${(script.perUserCooldownMs / 60_000).toFixed(1)}min`,
        `lock amounts       : ${[...new Set(script.users.map((u) => u.lockAmountEth))].join(', ')} ETH (min ${MIN_LOCK_AMOUNT_ETH})`,
        `mina tx fee        : ${script.minaTxFeeNanomina / 1e9} MINA`,
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

    const observer = startBridgeObserver(script.noriWssUrl);

    // Install stdout hijack before any further log output so the ring buffer
    // captures everything (logger.log, scheduler ticks, etc). The TTY is put
    // into alt-screen + cursor-hidden so regular scrolling never fights the
    // redraw. All of this is reverted in stopTTY() / shutdown paths.
    let uiActive = false;
    const enterAltScreen = () => {
        if (!process.stdout.isTTY) return;
        installStdoutHijack();
        bypassStdout = true;
        originalStdoutWrite('\x1b[?1049h'); // alt screen
        originalStdoutWrite('\x1b[?25l');   // hide cursor
        originalStdoutWrite('\x1b[2J\x1b[H'); // clear + home
        bypassStdout = false;
        uiActive = true;
    };
    const leaveAltScreen = () => {
        if (!uiActive) return;
        bypassStdout = true;
        originalStdoutWrite('\x1b[?25h');   // show cursor
        originalStdoutWrite('\x1b[?1049l'); // leave alt screen
        bypassStdout = false;
        restoreStdout();
        uiActive = false;
    };
    enterAltScreen();

    // TUI state: -1 == ALL users summary; >= 0 == specific user detail.
    let selectedUserIndex = -1;
    const TOP_RIGHT_ROWS = 14;

    const formatSec = (s: number | undefined): string => {
        if (s === undefined || !Number.isFinite(s)) return '—';
        if (s < 60) return `${Math.floor(s)}s`;
        const m = Math.floor(s / 60);
        const r = Math.floor(s % 60);
        return `${m}m${String(r).padStart(2, '0')}s`;
    };
    const formatAgo = (t: number | undefined): string => {
        if (!t) return 'never';
        const d = Math.floor((Date.now() - t) / 1000);
        if (d < 60) return `${d}s ago`;
        const m = Math.floor(d / 60);
        const s = d % 60;
        return `${m}m${String(s).padStart(2, '0')}s ago`;
    };
    const formatNum = (n: number | null | undefined, digits = 4): string => {
        if (n === null || n === undefined || !Number.isFinite(n)) return '—';
        return n.toFixed(digits);
    };

    const LEFT_PANE_WIDTH = 40;

    // Wrap a single line to `width`, indenting continuation rows under the
    // value column when the line is `LABEL: value` style. Otherwise indents
    // continuations by 2 spaces.
    const wrapLine = (line: string, width: number): string[] => {
        if (line.length <= width) return [line];
        const m = line.match(/^([^:]*?:\s+)(.+)$/);
        let prefix = '';
        let value = line;
        if (m) {
            prefix = m[1];
            value = m[2];
        }
        const indent = prefix ? ' '.repeat(prefix.length) : '  ';
        const firstWidth = Math.max(1, width - prefix.length);
        const contWidth = Math.max(1, width - indent.length);
        const out: string[] = [];
        out.push(prefix + value.slice(0, firstWidth));
        for (let i = firstWidth; i < value.length; i += contWidth) {
            out.push(indent + value.slice(i, i + contWidth));
        }
        return out;
    };

    const buildLeftPane = (): string[] => {
        const snap = observer.snapshot();
        const now = Date.now();
        const running = userStates.filter((u) => u.status === 'RUNNING').length;
        const cooling = userStates.filter(
            (u) => u.status === 'IDLE' && now < u.nextEligibleAt
        ).length;
        const idle = userStates.length - running - cooling;
        const bridgeAge = snap.latestBridge
            ? `${Math.floor((now - snap.lastBridgeAt) / 1000)}s`
            : 'n/a';
        const ethAge = snap.latestEth
            ? `${Math.floor((now - snap.lastEthAt) / 1000)}s`
            : 'n/a';
        const bridgeLine = snap.latestBridge
            ? `stage=${snap.latestBridge.stage_name}`
            : `waiting`;
        const ethLine = snap.latestEth
            ? `slot=${snap.latestEth.latest_finality_slot} blk=${snap.latestEth.latest_finality_block_number}`
            : `waiting`;
        const drainTag = draining ? ' [DRAINING]' : '';
        const raw = [
            ...PLANKTON_ANSI,
            '─'.repeat(LEFT_PANE_WIDTH - 6),
            `time  : ${new Date().toISOString().slice(11, 19)}Z${drainTag}`,
            `ws    : ${snap.wsState}`,
            `users : run=${running} cool=${cooling} idle=${idle}`,
            `bridge: ${bridgeLine} (${bridgeAge})`,
            `eth   : ${ethLine} (${ethAge})`,
            '',
            `keys  : ←/→ select user`,
            `        ! launch all IDLE`,
            `        g graceful drain`,
            `        Ctrl+C immediate`,
        ];
        const wrapped: string[] = [];
        for (const line of raw) {
            for (const w of wrapLine(line, LEFT_PANE_WIDTH)) wrapped.push(w);
        }
        return wrapped;
    };

    // Map raw stage_name to compact pipeline buckets. One bucket may have
    // multiple stage_names that we collapse into a "current step of" view.
    const PIPELINE_BUCKETS: ReadonlyArray<{
        label: string;
        stages: readonly string[];
    }> = [
            {
                label: 'EthSubmit',
                stages: [
                    'EthProcessorTransactionSubmitting',
                    'EthProcessorTransactionSubmitSucceeded',
                ],
            },
            {
                label: 'EthFinalize',
                stages: ['EthProcessorTransactionFinalizationSucceeded'],
            },
            {
                label: 'BridgeHead',
                stages: ['BridgeHeadJobCreated', 'BridgeHeadJobSucceeded'],
            },
            {
                label: 'ProofConv',
                stages: [
                    'ProofConversionJobReceived',
                    'ProofConversionJobSucceeded',
                ],
            },
            {
                label: 'EthProof',
                stages: [
                    'EthProcessorProofRequest',
                    'EthProcessorProofSucceeded',
                ],
            },
        ];

    const bucketFor = (stageName: string): string | undefined => {
        for (const b of PIPELINE_BUCKETS) {
            if (b.stages.includes(stageName)) return b.label;
        }
        return undefined;
    };

    // Human-readable label for the deposit_processing_status values. The
    // bridge stage_name pipeline only matters during
    // WaitingForCurrentJobCompletion — until then the deposit is either
    // (a) waiting for L1 finality or (b) waiting for the current bridge
    // batch to finish before its own batch starts.
    const PHASE_LABELS: Record<string, string> = {
        WaitingForEthFinality: 'Awaiting ETH finality',
        WaitingForPreviousJobCompletion: 'Waiting for batch turn',
        WaitingForCurrentJobCompletion: 'Bridge processing batch',
        ReadyToMint: 'Ready to mint',
        MissedMintingOpportunity: 'Missed mint window',
    };
    const phaseLabel = (status: string): string =>
        PHASE_LABELS[status] ?? status;

    const buildUserDetailPanel = (u: UserState, w: number): string[] => {
        const headerLabel = `user: ${u.cfg.label}  [${u.status}]`;
        const now = Date.now();
        const flowElapsed = u.flowStartedAt
            ? formatSec((now - u.flowStartedAt) / 1000)
            : 'pre-lock';
        const cur = u.currentStage;
        const curRec = u.stages[u.stages.length - 1];
        const curPhase = u.phaseEvents[u.phaseEvents.length - 1];
        const etaLabel =
            curRec && curRec.etaSec && curRec.etaSec > 0
                ? `~${formatSec(curRec.etaSec)} eta`
                : 'eta —';

        // Pipeline: top-level rows are the deposit's high-level phases.
        // Bridge stage_name events only matter while the current phase is
        // WaitingForCurrentJobCompletion — show those indented under it.
        const pipelineRows: string[] = ['pipeline:'];
        if (u.flowStartedAt) {
            const lockEnd = u.phaseEvents[0]?.startedAt;
            const lockDur = lockEnd
                ? formatSec((lockEnd - u.flowStartedAt) / 1000)
                : formatSec((now - u.flowStartedAt) / 1000);
            const lockMark = lockEnd ? '●' : '◐';
            pipelineRows.push(`  ${lockMark} ETH lock submitted  ${lockDur}`);
        }
        if (u.phaseEvents.length === 0) {
            if (u.flowStartedAt) {
                pipelineRows.push('  ○ (waiting for first deposit event…)');
            } else {
                pipelineRows.push('  (no deposit events yet)');
            }
        } else {
            for (let i = 0; i < u.phaseEvents.length; i++) {
                const p = u.phaseEvents[i];
                const isCurrent = p === curPhase;
                const dur = p.finishedAt
                    ? formatSec((p.finishedAt - p.startedAt) / 1000)
                    : formatSec((now - p.startedAt) / 1000);
                const mark = p.finishedAt ? '●' : '◐';
                pipelineRows.push(`  ${mark} ${phaseLabel(p.status)}  ${dur}`);

                // Show bridge sub-stages only during the active
                // WaitingForCurrentJobCompletion phase (older batches
                // observed during WaitingForPrevious… are not ours).
                if (
                    isCurrent &&
                    p.status === 'WaitingForCurrentJobCompletion'
                ) {
                    const innerStages = u.stages.filter(
                        (s) => s.startedAt >= p.startedAt
                    );
                    for (const s of innerStages) {
                        const isStageActive = s === curRec;
                        const sMark = isStageActive
                            ? '◐'
                            : s.finishedAt
                                ? '●'
                                : '●';
                        const realElapsed = Math.max(
                            s.serverElapsedSec,
                            Math.floor((now - s.startedAt) / 1000)
                        );
                        const sDur = isStageActive
                            ? `${formatSec(realElapsed)} real · ${etaLabel}`
                            : s.finishedAt
                                ? formatSec(
                                    (s.finishedAt - s.startedAt) / 1000
                                )
                                : formatSec(s.serverElapsedSec);
                        const bucket = bucketFor(s.name);
                        const name = bucket
                            ? `${bucket} (${s.name})`
                            : s.name;
                        pipelineRows.push(`      ${sMark} ${name}  ${sDur}`);
                    }
                }
            }
        }

        const bal = u.balances;
        const balLine1 = bal
            ? `ETH=${formatNum(bal.eth, 5)}  MINA=${formatNum(bal.mina, 4)}  nETH=${formatNum(bal.nEth, 6)}`
            : 'ETH=—  MINA=—  nETH=—';
        const balAge = u.balancesLoading
            ? '(loading…)'
            : bal?.error
                ? `(err: ${bal.error})`
                : `(${formatAgo(bal?.fetchedAt)})`;

        const slotLabel = u.lastSlots
            ? `${u.lastSlots.inSlot} → ${u.lastSlots.outSlot}`
            : '—';
        // Top-of-panel summary: high-level phase, plus the in-flight bridge
        // stage when (and only when) it's actually meaningful.
        const phaseLine = curPhase ? phaseLabel(curPhase.status) : '—';
        const stageLine =
            curPhase?.status === 'WaitingForCurrentJobCompletion' && cur
                ? `${bucketFor(cur) ?? cur}`
                : '—';

        const out = [
            headerLabel,
            `flow  : ${flowElapsed}  ·  runs ${u.stats.runs} ok=${u.stats.successes} fail=${u.stats.failures} skip=${u.stats.skipped}`,
            `phase : ${phaseLine}`,
            `stage : ${stageLine}`,
            `slot  : ${slotLabel}`,
            '',
            ...pipelineRows,
            '',
            `bal   : ${balLine1}`,
            `        ${balAge}`,
        ];
        // Pad/truncate to TOP_RIGHT_ROWS
        while (out.length < TOP_RIGHT_ROWS) out.push('');
        return out.slice(0, TOP_RIGHT_ROWS).map((l) => l.slice(0, w));
    };

    const buildAllUsersPanel = (w: number): string[] => {
        const header = 'users (←/→ to focus)';
        const rows: string[] = [header];
        for (let i = 0; i < userStates.length; i++) {
            const u = userStates[i];
            const curPhase = u.phaseEvents[u.phaseEvents.length - 1];
            const curRec = u.stages[u.stages.length - 1];
            // High-level phase is the meaningful indicator. The bridge
            // sub-stage is only relevant during WaitingForCurrentJobCompletion.
            let stageLabel: string;
            let durRef: number | undefined;
            if (curPhase) {
                if (curPhase.status === 'WaitingForCurrentJobCompletion' && curRec) {
                    stageLabel = `${phaseLabel(curPhase.status)} · ${bucketFor(curRec.name) ?? curRec.name}`;
                    durRef = Math.max(curRec.serverElapsedSec * 1000, Date.now() - curRec.startedAt);
                } else {
                    stageLabel = phaseLabel(curPhase.status);
                    durRef = Date.now() - curPhase.startedAt;
                }
            } else if (u.status === 'RUNNING') {
                stageLabel = u.flowStartedAt ? 'pre-deposit' : 'compiling…';
            } else if (u.nextEligibleAt > Date.now()) {
                stageLabel = 'COOLING';
            } else {
                stageLabel = 'IDLE';
            }
            const dur = durRef !== undefined ? ` ${formatSec(durRef / 1000)}` : '';
            const stats = `runs=${u.stats.runs} ok=${u.stats.successes} f=${u.stats.failures}`;
            rows.push(
                `  ${u.cfg.label.padEnd(8)} ${u.status.padEnd(7)} ${stageLabel}${dur}  ${stats}`
            );
        }
        while (rows.length < TOP_RIGHT_ROWS) rows.push('');
        return rows.slice(0, TOP_RIGHT_ROWS).map((l) => l.slice(0, w));
    };

    const renderFrame = () => {
        if (!uiActive) return;
        const termW = Math.max(60, process.stdout.columns ?? 120);
        const termH = Math.max(16, process.stdout.rows ?? 40);
        const leftLines = buildLeftPane();
        const leftW = Math.min(
            LEFT_PANE_WIDTH,
            leftLines.reduce((m, l) => Math.max(m, visibleLen(l)), 0)
        );
        const sep = ' │ ';
        const rightW = Math.max(20, termW - leftW - sep.length);
        const rows = termH - 1;

        // Left pane: bottom-aligned so plankton scrolls off the top first.
        const leftVisible = leftLines.slice(
            Math.max(0, leftLines.length - rows)
        );

        const topRows = Math.min(TOP_RIGHT_ROWS, Math.max(4, rows - 3));
        const logRows = Math.max(1, rows - topRows - 1); // -1 for divider row

        const topPanel =
            selectedUserIndex >= 0 &&
                selectedUserIndex < userStates.length
                ? buildUserDetailPanel(userStates[selectedUserIndex], rightW)
                : buildAllUsersPanel(rightW);

        // Wrap log lines to rightW and take the last logRows wrapped lines.
        const wrapped: string[] = [];
        for (const raw of logRing.tail(500)) {
            const plain = stripAnsi(raw);
            if (plain.length === 0) {
                wrapped.push('');
                continue;
            }
            for (let i = 0; i < plain.length; i += rightW) {
                wrapped.push(plain.slice(i, i + rightW));
            }
        }
        const tail = wrapped.slice(Math.max(0, wrapped.length - logRows));
        const tailOffset = Math.max(0, logRows - tail.length);

        bypassStdout = true;
        originalStdoutWrite('\x1b[H'); // home cursor
        for (let r = 0; r < rows; r++) {
            const leftLine = r < leftVisible.length ? leftVisible[r] : '';
            const left = padRightVisible(leftLine, leftW);

            let right = '';
            if (r < topRows) {
                right = topPanel[r] ?? '';
            } else if (r === topRows) {
                right = '─'.repeat(rightW);
            } else {
                const tIdx = r - topRows - 1 - tailOffset;
                right =
                    tIdx >= 0 && tIdx < tail.length
                        ? tail[tIdx]
                        : '';
            }

            originalStdoutWrite(left + sep + right + '\x1b[K');
            if (r < rows - 1) originalStdoutWrite('\n');
        }
        bypassStdout = false;
    };
    const statusInterval = setInterval(renderFrame, 1000);
    process.stdout.on('resize', renderFrame);

    // Two shutdown modes:
    //   - Immediate (Ctrl+C / SIGTERM): exit now, kill in-flight flows.
    //   - Graceful ('g' key):            stop scheduling, wait for running
    //                                    flows to finish, then exit.
    let shuttingDown = false;
    let draining = false;
    let drainInterval: NodeJS.Timeout | undefined;
    // Shared with every in-flight runUserFlow so that on graceful drain a user
    // sitting in the post-canMint claim-lag wait can short-circuit and head
    // straight to the mint (which itself retries up to MINT_RETRY_ATTEMPTS).
    const drainSignal: DrainSignal = {
        requested: false,
        signal$: new Subject<void>(),
    };
    const stopTTY = () => {
        if (process.stdin.isTTY) {
            try {
                process.stdin.setRawMode(false);
            } catch { /* ignore */ }
            process.stdin.pause();
        }
    };
    const shutdown = (signal: string) => {
        if (shuttingDown && !draining) return;
        shuttingDown = true;
        draining = false;
        if (drainInterval) clearInterval(drainInterval);
        logger.log(`${signal} received — shutting down immediately.`);
        appendLine(aggregatePath, tsLine(`${signal} — immediate shutdown`));
        clearInterval(statusInterval);
        observer.stop();
        stopTTY();
        leaveAltScreen();
        setTimeout(() => process.exit(0), 200);
    };
    const gracefulShutdown = () => {
        if (shuttingDown || draining) return;
        draining = true;
        shuttingDown = true; // prevents new ticks from launching flows
        // Tell every in-flight flow to short-circuit any claim-lag wait so
        // ReadyToMint users mint immediately. The mint itself still goes
        // through the standard 3-retry path — we don't shortcut that.
        drainSignal.requested = true;
        drainSignal.signal$.next();
        logger.log(
            "'g' received — graceful shutdown: skipping claim-lag, waiting for in-flight flows to finish (Ctrl+C to abort)."
        );
        appendLine(
            aggregatePath,
            tsLine('graceful shutdown requested — draining in-flight flows')
        );
        drainInterval = setInterval(() => {
            const running = userStates.filter((u) => u.status === 'RUNNING').length;
            if (running === 0) {
                clearInterval(drainInterval);
                logger.log('Drain complete — exiting.');
                appendLine(aggregatePath, tsLine('drain complete — exit'));
                clearInterval(statusInterval);
                observer.stop();
                stopTTY();
                setTimeout(() => process.exit(0), 200);
            }
        }, 500);
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // `!` key: bring the scheduler forward for every IDLE user that's still
    // in cooldown. Respects maxConcurrent — the subsequent tick will only
    // launch up to `slotsAvailable` flows; any leftovers get picked up on
    // the next natural tick (their nextEligibleAt is already 0).
    const fireAllIdle = () => {
        if (shuttingDown) return;
        const touched = userStates.filter(
            (u) => u.status === 'IDLE' && u.nextEligibleAt > 0
        );
        for (const u of touched) u.nextEligibleAt = 0;
        logger.log(
            `[!] cleared cooldown for ${touched.length}/${userStates.length} idle user(s); firing tick`
        );
        try {
            tick();
        } catch (err) {
            logger.error(`tick (from !) error: ${String(err)}`);
        }
    };

    // Cycle selectedUserIndex through [-1 (ALL), 0 .. N-1]. On switch to a
    // real user, kick a balance refresh so the pane shows fresh numbers.
    const cycleUser = (delta: 1 | -1) => {
        const total = userStates.length + 1; // +1 for ALL
        const cur = selectedUserIndex + 1; // [0..N]
        const next = (cur + delta + total) % total;
        selectedUserIndex = next - 1;
        if (selectedUserIndex >= 0) {
            const u = userStates[selectedUserIndex];
            if (!u.balancesLoading) {
                void fetchPaneBalances(u, script, etherProvider);
            }
        }
        renderFrame();
    };

    // Raw-mode keystroke listener. In raw mode Ctrl+C no longer raises SIGINT
    // automatically, so we dispatch it manually by character code. Arrow
    // keys arrive as 3-byte CSI sequences (ESC [ C | ESC [ D).
    if (process.stdin.isTTY) {
        try {
            process.stdin.setRawMode(true);
            process.stdin.setEncoding('utf8');
            process.stdin.resume();
            process.stdin.on('data', (key: string) => {
                if (key === '\u0003') shutdown('SIGINT');
                else if (key === 'g' || key === 'G') gracefulShutdown();
                else if (key === '!') fireAllIdle();
                else if (key === '\x1b[C') cycleUser(1); // right arrow
                else if (key === '\x1b[D') cycleUser(-1); // left arrow
            });
            logger.log(
                "Keys: ←/→ select user, ! launch idle, g drain, Ctrl+C immediate."
            );
        } catch (err) {
            logger.log(`raw-mode stdin unavailable: ${String(err)}`);
        }
    }

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
        const uLog = new UserFileLogger(
            aggregatePath,
            userLogPath,
            u.cfg.label,
            aggregateDedup
        );
        uLog.log(`=== flow #${u.stats.runs} start ===`);

        runUserFlow(u, script, uLog, etherProvider, compileSemaphore, drainSignal, (us) => {
            // Refresh balances on every stage transition, but only for the
            // currently-selected user to avoid burning RPC budget on all N.
            if (
                selectedUserIndex >= 0 &&
                userStates[selectedUserIndex] === us &&
                !us.balancesLoading
            ) {
                void fetchPaneBalances(us, script, etherProvider);
            }
        })
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

const PLANKTON_ANSI: readonly string[] = [
    '          ⢠⡀           ⢦',
    '           ⢳⡀          ⠘⣇',
    '            ⢹⣤⡀         ⢽⡤',
    '            ⠁⢹⡄         ⠈⣇',
    '              ⣻⣄⡀       ⠠⢿⠄',
    '             ⠈⠁⢷⡀        ⢸⡇',
    '               ⠘⣷       ⢀⣸⣧',
    '               ⠖⢻⣗       ⢸⣿',
    '                ⠘⣿⡀      ⣸⣿⡀',
    '                ⢠⢿⣷⠤    ⠈⢸⣿⠉',
    '                 ⠸⣿⡀     ⢸⣿',
    '                  ⣿⣇    ⠊⢹⡟⠢',
    '                 ⠊⢹⣏⠁ ⣠⠖⠉⠋⠓⢤⡀',
    '                ⢀⣔⠚⠙⠐⠤⠃     ⠱⡄',
    '             ⢠⣶⣿⣿⡿⢿⡿⣀⡀ ⢠⣴⣶⣿⣷⣶⣶⡀',
    '             ⠈⢉⣜⣥⣶⣶⣶⣶⡝⢶⢋⣋⣩⣭⣭⡙⢿⢏',
    '             ⢠⡏⣞⣛⣛⠛⠛⡻⡿⠷⡿⠛⠛⣛⣛⣛⡘⣿⡀',
    '             ⢸⠉⠉⠁⠸⣿⣿⡞⠉⠉⠉⣿⣿⣶⠁⠉⠉⢹⡇',
    '             ⢸⡄   ⠈⠉  ⡀ ⠈⠉⠁   ⡜⡇',
    '            ⣠⢼⢙⠦⣄⣀⣀⣀⡤⢞⢙⠢⣄⣀⣀⣀⡤⢞ ⣳⢂⣄',
    '         ⣀⣠⢺⡄⣟⣸⣷⣶⣿⣭⣶⣾⣾⣿⣿⣶⠏⣳⢦⢸⢗⡜⡱⢋⡈⢳⡀',
    '      ⣠⠞⣩⠅⣀⠁⢷⢹⣸⣿⣿⣿⢮⣭⣭⣭⣭⣤⠶⢞⣡⣮⢮⠞⡼⢛⠛⡉⠉⠻⡝⠢⡀',
    '     ⢰⡇⢸⣷⣾⣿⡟⣸⡌⣷⠿⠿⢭⣟⡶⣶⠶⢶⣶⣬⠽⠿⣿⠏⣼⠁⣌⡇⣸⣤ ⣶ ⣿⡄',
    '     ⠘⣧⡛⣧⠛⣛⣵⣿⡇⠘⢮⣳⣶⣬⡙⢯⠞⣉⣤⣶⢖⡴⠁ ⣿⣆⠻⣿⣿⠟⣡⡟⣠⣿⠃',
    '      ⣸⠿⠿⢿⢩⣤⡉⢧ ⣀⣹⠮⣯⣥⣿⣘⣻⣽⣞⣉⡀⣰⠚⣡⣌⢻⣶⣶⣾⣿⣿⣿⠃',
    '      ⢹⣎⣛⢿⣾⣿⡥⠾⠾⠷⢶⣦⣔⡲⣬⣭⣉⣙⣛⡒⠾⣇⣾⣿⠟⣸⡟⣭⡅⣿⣿⠇',
    '       ⠻⣿⡷⣿⣿⣾⣿⣽⣷⣶⢝⣿⣿⣷⣭⡙⡷⣯⣭⣵⣼⣿⣷⡟⣫⣴⣿⣾⣿⠋',
    '        ⠈⢿⣿⣿⣿⣿⣿⣿⣿⠿⠛⠉⠠⢙⠿⣿⣷⣿⣿⣿⣿⣻⣿⣿⠿⣻⠕⠁',
    '          ⠉⠈⢹⠉⠉⠁        ⠉⠛⠛⠛⠿⠟⠁ ⣸⠁',
    '            ⠸⣀               ⣀⣠⣤⠋',
    '             ⢹⣿⣿⣶⣶⣶⣶⣶⣶⣶⣶⣶⣶⣿⣿⣿⣿⣿⡟',
    '             ⠘⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠇',
    '              ⢹⣿⣿⣿⣿⣿⠟⠛⠛⠛⢿⣿⣿⣿⣿⣿⡟',
    '              ⠈⣿⣿⣿⠟⠁     ⠙⢿⣿⣿⠟',
    '            ⢀⣠⣴⣾⣿⣯⡀       ⣈⣿⣯⣄',
    '            ⠈⠉⠉⠉⠉⠉⠁      ⠘⠛⠛⠛⠛⠛',
] as const;