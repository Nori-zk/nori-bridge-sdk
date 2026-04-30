#!/usr/bin/env node
/**
 * Run `MOCK_computeMintProofAndCache` on a Node-side mint worker using
 * the cached `.test-state/mint-resume.json` from a previous browser
 * run, and print peak resident memory at each stage. The point is to
 * answer one question: does the mint prove fundamentally need more
 * than ~4 GB of process RSS? If it does, browser-only is impossible
 * (32-bit WASM caps at 4 GB linear memory). If peak RSS comfortably
 * fits under ~3.5 GB on Node, then browser-only is theoretically
 * possible and we should chase bundle bloat / leak in the page.
 *
 * Reports VmRSS (live) every 100 ms via /proc/self/status, plus the
 * kernel-tracked peak (VmHWM) at the end for cross-check. Note
 * `process.memoryUsage()` only reports the parent worker thread's V8
 * heap; the actual mint compute runs in a Node `worker_threads` child,
 * which shares this process's address space — so `/proc/self/status`
 * is the only number that reflects the WHOLE picture (parent + child
 * V8 heaps + WASM linear memory).
 *
 * Prereq: the browser e2e must have run far enough to write a full
 * resume file (depositAttestationInput + needsToFundAccount populated).
 * Run `npm run test:e2e:browser` once until it gets past `canMint`,
 * then run this script.
 *
 * Usage:
 *   npm run measure-mint
 *
 * Or directly with the same V8 flags the contracts/mina node scripts use:
 *   node --max-old-space-size=8192 --max-semi-space-size=128 \
 *        --no-liftoff --no-wasm-tier-up \
 *        --experimental-vm-modules --experimental-wasm-modules \
 *        build/bin/measureMintProof.js
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { Logger, LogPrinter } from 'esm-iso-logger';
import { PrivateKey } from 'o1js';
import { getStagingEnv } from '@nori-zk/mina-token-bridge/node';
import { getTokenBridgeMintWorker } from '@nori-zk/mina-token-bridge/node/workers/tokenBridgeMintWorker';

new LogPrinter('MeasureMintProof');
const logger = new Logger('MeasureMintProof');

const STATE_FILE = path.resolve('.test-state/mint-resume.json');
const messageSCRAMStr = 'NoriZK25';

function readPidProcKb(pid: number, label: 'VmRSS' | 'VmHWM'): number {
    try {
        const status = fs.readFileSync(`/proc/${pid}/status`, 'utf-8');
        const re = new RegExp(`^${label}:\\s+(\\d+)\\s+kB`, 'm');
        const m = status.match(re);
        return m ? Number(m[1]) : 0;
    } catch {
        return 0;
    }
}
const parentRssMb = () => Math.round(readPidProcKb(process.pid, 'VmRSS') / 1024);
const parentHwmMb = () => Math.round(readPidProcKb(process.pid, 'VmHWM') / 1024);

// Direct children of *this* process. Worker spawned via the
// `@nori-zk/workers/node/parent` proxy is a fork via
// `child_process.spawn`, so it shows up here. (Worker.terminate()
// reaps it.) Returns an empty list before the worker is spawned and
// after it's terminated.
function childrenPids(): number[] {
    try {
        const raw = fs
            .readFileSync(`/proc/${process.pid}/task/${process.pid}/children`, 'utf-8')
            .trim();
        if (!raw) return [];
        return raw.split(/\s+/).map(Number).filter((n) => Number.isFinite(n));
    } catch {
        return [];
    }
}
function summedChildRssMb(): number {
    let kb = 0;
    for (const pid of childrenPids()) kb += readPidProcKb(pid, 'VmRSS');
    return Math.round(kb / 1024);
}
function maxChildHwmMb(): number {
    let max = 0;
    for (const pid of childrenPids()) {
        const hwm = readPidProcKb(pid, 'VmHWM');
        if (hwm > max) max = hwm;
    }
    return Math.round(max / 1024);
}

interface CachedMintState {
    depositBlockNumber: number;
    signatureSCRAMBase58: string;
    codeChallengeSCRAMStr: string;
    depositAttestationInput?: unknown;
    needsToFundAccount?: boolean;
}

async function main() {
    if (!fs.existsSync(STATE_FILE)) {
        throw new Error(
            `Resume state not found at ${STATE_FILE}. Run the browser e2e until canMint completes (so the full state is cached) and then rerun this script.`
        );
    }
    const cached = JSON.parse(
        fs.readFileSync(STATE_FILE, 'utf-8')
    ) as CachedMintState;
    if (
        cached.depositAttestationInput === undefined ||
        cached.needsToFundAccount === undefined
    ) {
        throw new Error(
            'Cached state is post-lock only (missing depositAttestationInput / needsToFundAccount). Run the browser e2e past canMint first so the full mint inputs are cached.'
        );
    }

    const minaSenderPrivateKeyBase58 = process.env.MINA_SENDER_PRIVATE_KEY;
    const noriMinaTokenBridgeAddressBase58 =
        process.env.NORI_MINA_TOKEN_BRIDGE_ADDRESS;
    if (!minaSenderPrivateKeyBase58 || !noriMinaTokenBridgeAddressBase58) {
        throw new Error(
            'MINA_SENDER_PRIVATE_KEY and NORI_MINA_TOKEN_BRIDGE_ADDRESS must be set in the environment / .env'
        );
    }
    const minaSenderPublicKeyBase58 = PrivateKey.fromBase58(
        minaSenderPrivateKeyBase58
    )
        .toPublicKey()
        .toBase58();

    const stagingEnv = getStagingEnv();
    const minaConfig = {
        networkId: 'devnet' as const,
        mina: stagingEnv.MINA_RPC_NETWORK_URL,
        archive: stagingEnv.MINA_ARCHIVE_RPC_URL,
    };

    // Parent + children peak trackers. Children sum reflects how much
    // RSS the spawned mint-worker child process(es) hold; that's the
    // only number that mirrors what the browser worker has to fit
    // under the WASM 4 GB cap.
    let peakParentRssMb = parentRssMb();
    let peakChildRssMb = summedChildRssMb();
    let peakLabel = 'boot';
    const sampler = setInterval(() => {
        const p = parentRssMb();
        const c = summedChildRssMb();
        if (p > peakParentRssMb) peakParentRssMb = p;
        if (c > peakChildRssMb) peakChildRssMb = c;
    }, 100);

    function snap(label: string) {
        const p = parentRssMb();
        const c = summedChildRssMb();
        if (p > peakParentRssMb) {
            peakParentRssMb = p;
        }
        if (c > peakChildRssMb) {
            peakChildRssMb = c;
            peakLabel = label;
        }
        const heap = process.memoryUsage();
        logger.log(
            `[mem] ${label} parent rss=${p}MB peak=${peakParentRssMb}MB | child rss=${c}MB peak=${peakChildRssMb}MB | parent heapUsed=${(heap.heapUsed / 1024 / 1024).toFixed(0)}MB external=${(heap.external / 1024 / 1024).toFixed(0)}MB`
        );
    }

    try {
        snap('boot');
        logger.log(
            `Resumed inputs: depositBlockNumber=${cached.depositBlockNumber} needsToFundAccount=${cached.needsToFundAccount}`
        );

        logger.log('Spawning mint worker (Node worker_threads).');
        const TokenBridgeWorkerMint = getTokenBridgeMintWorker();
        const tokenBridgeWorkerMint = new TokenBridgeWorkerMint();
        snap('after-spawn');

        await tokenBridgeWorkerMint.WALLET_setMinaPrivateKey(
            minaSenderPrivateKeyBase58
        );
        await tokenBridgeWorkerMint.minaSetup(minaConfig);
        snap('after-setup');

        // Pass a cacheServer URL via $MINT_CACHE_SERVER to short-circuit
        // the heavy prover-key computation (compile time only — not
        // steady-state memory; loaded prover keys still sit in WASM).
        // Default: no cache. Local cache server URL is typically
        // http://localhost:4210 (start with `cd cache-server && npm run serve`).
        const cacheServer = process.env.MINT_CACHE_SERVER;
        logger.log(
            cacheServer
                ? `Compiling minter dependencies (cached @ ${cacheServer}).`
                : 'Compiling minter dependencies (no cache).'
        );
        const tCompile = Date.now();
        await tokenBridgeWorkerMint.compileAll(cacheServer);
        logger.log(
            `Compile took ${((Date.now() - tCompile) / 1000).toFixed(1)}s`
        );
        snap('after-compile');

        logger.log('Computing mint proof (MOCK_computeMintProofAndCache).');
        const tProve = Date.now();
        await tokenBridgeWorkerMint.MOCK_computeMintProofAndCache(
            minaSenderPublicKeyBase58,
            noriMinaTokenBridgeAddressBase58,
            cached.depositAttestationInput as Parameters<
                InstanceType<
                    ReturnType<typeof getTokenBridgeMintWorker>
                >['MOCK_computeMintProofAndCache']
            >[2],
            messageSCRAMStr,
            cached.signatureSCRAMBase58,
            1e9 * 0.1,
            cached.needsToFundAccount
        );
        logger.log(
            `Prove took ${((Date.now() - tProve) / 1000).toFixed(1)}s`
        );
        snap('after-prove');

        // Capture child VmHWM right BEFORE terminate (after-prove
        // reaps a lot of state, so we want this snapshot now while
        // the child is still alive).
        const childHwmAtFinish = maxChildHwmMb();

        logger.log('=========================================');
        logger.log(
            `Parent peak RSS: ${peakParentRssMb} MB | VmHWM ${parentHwmMb()} MB`
        );
        logger.log(
            `Child  peak RSS: ${peakChildRssMb} MB at "${peakLabel}" | VmHWM ${childHwmAtFinish} MB`
        );
        logger.log('=========================================');
        logger.log(
            `Decision rule: the child VmHWM is what the browser worker has to fit under the 32-bit WASM 4 GB cap.`
        );
        logger.log(
            `  - <2500 MB → browser-only is plausible; the page is leaking/bloated and we chase that.`
        );
        logger.log(
            `  - 2500–3500 MB → browser-only is borderline, depends on page overhead.`
        );
        logger.log(
            `  - >3500 MB → browser-only mint is impossible without a memory64 o1js build.`
        );

        // Do not actually sign-and-send. Just measure.
        try {
            tokenBridgeWorkerMint.terminate();
        } catch {
            /* ignore */
        }
        process.exit(0);
    } finally {
        clearInterval(sampler);
    }
}

main().catch((err) => {
    if (err instanceof Error) {
        logger.error(`Fatal: ${err.name}: ${err.message}`);
        if (err.stack) logger.error(err.stack);
    } else if (err && typeof err === 'object') {
        try {
            logger.error(
                'Fatal (non-Error object):',
                JSON.stringify(err, Object.getOwnPropertyNames(err), 2)
            );
        } catch {
            logger.error('Fatal (unstringifiable):', err);
        }
    } else {
        logger.error('Fatal:', err);
    }
    process.exit(1);
});
