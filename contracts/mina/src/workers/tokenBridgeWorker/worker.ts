import { Logger, LogPrinter } from 'esm-iso-logger';
import {
    CacheType,
    compileAndOptionallyVerifyContracts,
    decodeConsensusMptProof,
    EthInput,
    NodeProofLeft,
    type NetworkCacheConfig,
} from '@nori-zk/o1js-zk-utils';
import type {
    ProofDataOutput,
    SP1ProofWithPublicValuesPlonkNoTee,
} from '@nori-zk/proof-conversion/min';
import {
    AccountUpdate,
    CircuitString,
    fetchAccount,
    Field,
    Mina,
    type NetworkId,
    PrivateKey,
    PublicKey,
    Signature,
    Transaction,
    type VerificationKey,
} from 'o1js';
import { NoriStorageInterface } from '../../NoriStorageInterface.js';
import { FungibleToken } from '../../TokenBase.js';
import { NoriTokenBridge } from '../../NoriTokenBridge.js';
import {
    buildMerkleTreeContractDepositAttestorInput,
    computeDepositAttestationWitness,
    type MerkleTreeContractDepositAttestorInputJson,
} from '../../depositAttestation.js';
import {
    codeChallengeFieldToBEHex,
    createCodeChallenge,
    SCRAMWitness,
} from '../../scram.js';
import { noriStorageInterfaceVkHash } from '../../integrity/NoriStorageInterface.VkHash.js';
import { fungibleTokenVkHash } from '../../integrity/FungibleToken.VkHash.js';
import { noriTokenBridgeVkHash } from '../../integrity/NoriTokenBridge.VkHash.js';
import {
    NoriStorageInterfaceCacheLayout,
    FungibleTokenCacheLayout,
    NoriTokenBridgeCacheLayout,
} from '../../cache-layouts/index.js';
import { cacheFactory } from '@nori-zk/o1js-zk-utils';

// `NoriTokenBridgeCacheLayout` is currently only referenced by the
// cached branch of `compileMinterDeps`, which is disabled until the
// o1js browser compilation cache is reliable. The `void` expression
// is here purely to silence the unused-import warning in the
// meantime; once the cached path is re-enabled the import is
// referenced by real call-site code and this line can be removed.
void NoriTokenBridgeCacheLayout;

// Initialise the side-effect log printer for this worker's logger
// namespace. Constructing the printer is what wires it into the
// shared logger infrastructure; the instance itself is not retained.
new LogPrinter('TokenBridgeWorker');

// Module-scoped logger shared by the top-level bootstrap trace below
// and by every method on `TokenBridgeWorker`.
const logger = new Logger('TokenBridgeWorker');

/**
 * Detects whether this module is currently executing inside a browser
 * runtime, covering both the main thread and a Web Worker context.
 * Returns `false` in Node (including Node worker threads).
 *
 * Used by `compileMinterDeps` to gate browser-only network cache
 * fetches (that cached path is currently disabled -- see the
 * `TokenBridgeWorker` class docstring), and by the bootstrap trace
 * below to record which runtime the worker was instantiated in.
 *
 * @returns `true` when running in a browser main thread or Web
 *   Worker, `false` otherwise (e.g. Node, or any environment that
 *   lacks both a DOM and Web Worker-style `importScripts`).
 */
export function isBrowser(): boolean {
    return (
        typeof self !== 'undefined' &&
        ((typeof window !== 'undefined' &&
            typeof window.document !== 'undefined') || // main thread
            (typeof self !== 'undefined' &&
                'importScripts' in self &&
                typeof self.importScripts === 'function')) // worker
    );
}

// Bootstrap trace emitted once on worker-bundle load so logs make it
// clear which runtime the worker was instantiated in.
logger.log('Constructing TokenBridgeWorker. isBrowser:', isBrowser());

/**
 * # TokenBridgeWorker
 *
 * Off-main-thread o1js bridge worker. Runs inside a browser Web Worker
 * (or a Node worker thread) behind the RPC bridge in `workers/defs.ts`,
 * wired through `workers/tokenBridgeWorker/{parent,child}.ts`.
 *
 * ## RPC surface and serialisation
 *
 * Every public (non-`#private`) method on this class is reachable by
 * the client over the RPC bridge. Because every call crosses a worker
 * boundary, every parameter and every return value on every public
 * method must be serialisation-safe: base58 / hex / decimal strings,
 * plain numbers and booleans, and plain JSON objects composed of the
 * same. No class instances cross the boundary -- not `Field`, not
 * `PublicKey`, not `Signature`, not `Mina.Transaction`, not
 * `VerificationKey`. Methods reconstruct those types from their
 * serialised form at call entry and re-serialise on return. If you add
 * a new public method, its signature and return type must honour this
 * invariant.
 *
 * There is no framework-level gate on which methods a client can reach.
 * The method-name prefixes below are a developer-facing convention that
 * says when each method is appropriate to call. Each method's docstring
 * states explicitly when it must not be called. Renaming any public
 * method is a client-visible API change.
 *
 * ## Production flow vs test flow
 *
 * Each stateful tx-producing operation (storage setup, mint) exists
 * under a production flow and one or more test flows. The test flows
 * stand in for the parts of the production flow that live outside
 * the worker (most importantly, the user's real wallet).
 *
 * ### Production flow (target public API)
 *
 * A real frontend calls a target-API method (`setupStorage`, `mint`)
 * and receives the proved transaction as a JSON string. The frontend
 * then hands that JSON to the user's real wallet (e.g. Auro), which
 * signs and submits it. The wallet lives entirely outside this file;
 * the worker has no counterpart method for the sign-and-send half of
 * this flow. The target-API method is the last worker call in the
 * production flow for that operation.
 *
 * ### Test flow: single-call mock
 *
 * Integration specs inject a throwaway private key into the worker via
 * `WALLET_setMinaPrivateKey`, then call `MOCK_setupStorage` /
 * `MOCK_mint`. Those collapse build, prove, sign and send into one
 * in-worker call using the throwaway key. Used when the spec does not
 * need to mirror the production call shape.
 *
 * ### Test flow: split-stage mock
 *
 * Integration specs that do want to mirror the production call shape
 * at the spec level use the pair
 * `MOCK_computeMintProofAndCache` (build-and-prove half, caches the
 * in-memory `Mina.Transaction` on the instance) followed by
 * `WALLET_MOCK_signAndSendMintProofCache` (sign-and-send half, using
 * the throwaway key). The handoff between the two is via an
 * in-instance field rather than JSON, which sidesteps the o1js blocker
 * described below. When that blocker is fixed, those specs migrate to
 * `mint` + `WALLET_signAndSend` as a structurally identical pair.
 *
 * ### Wallet emulation (`WALLET_signAndSend`)
 *
 * `WALLET_signAndSend` is the aspirational wallet-emulation companion
 * to the target-API methods: it takes the returned JSON tx, signs it
 * with the worker-held throwaway key, and submits it. Test-only -- in
 * tests it replaces the real wallet that a production frontend would
 * use. A production frontend never calls `WALLET_signAndSend`, because
 * in production the real wallet performs that step. Currently blocked
 * by the `Transaction.fromJSON` issue described below.
 *
 * ## Upstream o1js blockers
 *
 * Two o1js limitations shape the test-flow scaffolding:
 *
 * - `Transaction.fromJSON` does not round-trip a proved transaction
 *   with its `lazyAuthorization` intact, so `WALLET_signAndSend`
 *   cannot reconstruct a tx that was proved in-worker and then
 *   serialised. The in-progress attempt is preserved in the commented
 *   block near `deserializeTransaction` as a reference for the next
 *   attempt. Until this is fixed, split-stage test flows pass the
 *   proved tx between worker calls via an in-instance field
 *   (`#mintProofCache`) rather than JSON.
 *
 * - The o1js browser compilation cache does not function reliably, so
 *   `compileMinterDeps` force-delegates to `compileMinterDepsNoCache`.
 *   The cache-enabled body is retained in full so it can be
 *   reactivated with a single edit once the upstream issue is resolved.
 *
 * ## Method-name prefix key
 *
 * Safe in production code:
 *
 * - no prefix: target public API. Builds and proves a transaction and
 *   returns it as a JSON string; the user's real wallet signs and
 *   submits it.
 * - `SCRAM_`: pure SCRAM helpers (code-challenge creation,
 *   field-to-hex conversion). No wallet state required.
 *
 * Test-only -- must not be called from production frontend code:
 *
 * - `WALLET_setMinaPrivateKey`: injects a throwaway private key into
 *   the worker so subsequent `WALLET_`-prefixed methods can stand in
 *   for a real wallet.
 * - `WALLET_signAndSend`: wallet-emulation sign-and-send for a JSON tx
 *   returned by a target-API method. Replaces the real wallet in
 *   tests; never called from production. Currently blocked by the
 *   o1js `Transaction.fromJSON` issue above.
 * - `MOCK_`: single-call test variant of a target-API method
 *   (`MOCK_setupStorage`, `MOCK_mint`) that collapses the full build,
 *   prove, sign-and-send pipeline into one in-worker call.
 * - `WALLET_MOCK_`: wallet-emulation half of a split-stage mock,
 *   paired with a `MOCK_` proof-compute step that caches the proved
 *   tx in-instance.
 * - `MOCK_SCRAM_`: SCRAM helper that signs using the worker-held key.
 *   Production code must use the real wallet for SCRAM signing.
 */
export class TokenBridgeWorker {
    // ================================================================
    // Wallet interop (test-only)
    // ================================================================
    //
    // This section stands in for an external wallet during tests. In
    // production the user's real wallet (e.g. Auro) consumes the JSON
    // transaction returned by a target-API method (`setupStorage`,
    // `mint`) and performs the sign-and-send step outside the worker.
    //
    // The target behaviour we want to mirror in tests is: accept a
    // proved transaction as a JSON string, deserialise it with its
    // `lazyAuthorization` intact, sign it with the user's key, and
    // submit it. `Transaction.fromJSON` in o1js does not currently
    // round-trip a proved transaction's `lazyAuthorization`, so
    // `WALLET_signAndSend` cannot yet be driven end-to-end from JSON.
    // The commented `deserializeTransaction` block below is retained
    // as reference material for the next attempt once the upstream
    // issue is resolved.
    //
    // None of the methods in this section are appropriate to call
    // from production frontend code.

    // Initialise method used for MOCK methods
    #minaPrivateKey: PrivateKey;
    /**
     * Inject a throwaway Mina private key into the worker so that
     * subsequent `WALLET_`-prefixed and `MOCK_`-prefixed methods can
     * stand in for a real wallet during tests. The key is held in a
     * private class field and never leaves the worker.
     *
     * Must be called exactly once per worker instance. A second call
     * throws rather than silently replacing the key, to avoid
     * test-harness bugs where one spec's key bleeds into another.
     *
     * Not appropriate to call from production frontend code: a real
     * frontend never hands a private key to the worker, because the
     * user's real wallet performs all signing outside this file.
     *
     * @param minaPrivateKeyBase58 Base58-encoded Mina `PrivateKey` of
     *   the account that will pay fees for and authorise transactions
     *   produced by the `MOCK_` and `WALLET_MOCK_` methods.
     * @returns Resolves once the key has been installed.
     * @throws `Error` if a private key has already been set on this
     *   worker instance.
     */
    async WALLET_setMinaPrivateKey(minaPrivateKeyBase58: string) {
        if (this.#minaPrivateKey)
            throw new Error('Mina private key has already been set.');
        this.#minaPrivateKey = PrivateKey.fromBase58(minaPrivateKeyBase58);
    }

    /**
     * Work-in-progress reconstruction of a proved transaction from its
     * serialised JSON form, retained as reference material for the
     * next attempt once o1js supports round-tripping
     * `lazyAuthorization`.
     *
     * The approach: deserialise the JSON with `Mina.Transaction.fromJSON`
     * to recover the structural transaction, then reattach the
     * `lazyAuthorization` (and, where present, its `blindingValue`)
     * from a freshly-built sibling transaction `txNew` that still
     * carries that state in memory. This is needed because
     * `Transaction.fromJSON` drops `lazyAuthorization`, which the
     * signer needs to complete account-update authorisation.
     *
     * Disabled until the upstream o1js blocker is resolved.
     *
     * @param serializedTransaction JSON string carrying `{ tx,
     *   blindingValues, length }`: `tx` is the stringified proved
     *   transaction, `blindingValues` is the per-account-update
     *   blinding-value array (empty strings where absent), and
     *   `length` is the expected account-update count used as a
     *   sanity check against both the fresh sibling and the
     *   deserialised transaction.
     * @returns The reconstructed `Mina.Transaction` with
     *   `lazyAuthorization` restored on every account update.
     * @throws `Error` if the serialised transaction's account-update
     *   count disagrees with either the freshly-built sibling or
     *   itself.
     */
    /*private deserializeTransaction(serializedTransaction: string) {
        const { tx, blindingValues, length } = JSON.parse(
            serializedTransaction
        );
        const parsedTx = JSON.parse(tx);
        const transaction = Mina.Transaction.fromJSON(
            parsedTx
        ) as Mina.Transaction<false, false>;

        if (length !== txNew.transaction.accountUpdates.length) {
            throw new Error('New Transaction length mismatch');
        }
        if (length !== transaction.transaction.accountUpdates.length) {
            throw new Error('Serialized Transaction length mismatch');
        }
        for (let i = 0; i < length; i++) {
            transaction.transaction.accountUpdates[i].lazyAuthorization =
                txNew.transaction.accountUpdates[i].lazyAuthorization;
            if (blindingValues[i] !== '')
                (
                    transaction.transaction.accountUpdates[i]
                        .lazyAuthorization as any
                ).blindingValue = Field.fromJSON(blindingValues[i]);
        }
        return transaction;
    }*/

    /**
     * Minimal reconstruction of a transaction from its serialised JSON
     * form, using the stock `Transaction.fromJSON` with no
     * `lazyAuthorization` reattachment. Called by
     * `WALLET_signAndSend` as the deserialisation step prior to
     * signing.
     *
     * This form does not round-trip a proved transaction's
     * `lazyAuthorization` and is the direct cause of
     * `WALLET_signAndSend` being non-functional today; see the
     * class-level docstring for the o1js blocker. The commented-out
     * `payload` block below sketches an alternative shape (a signer
     * payload with `onlySign: true`, `feePayer.fee` and
     * `feePayer.memo`) kept for reference.
     *
     * Private helper: not reachable over the RPC surface, used only
     * by `WALLET_signAndSend`.
     *
     * @param serializedTransaction JSON string produced by
     *   `provedTx.toJSON()` on a target-API method's return value.
     * @returns The `Transaction` reconstructed by
     *   `Transaction.fromJSON`, suitable (in principle) for signing
     *   and submission.
     */
    private deserializeTransaction(serializedTransaction: string) {
        return Transaction.fromJSON(serializedTransaction);
    }

    /**
     * Wallet-emulation sign-and-send for a proved transaction returned
     * by a target-API method (`setupStorage`, `mint`). Reconstructs
     * the transaction from JSON, signs it with the throwaway key
     * installed by `WALLET_setMinaPrivateKey`, submits it to the
     * network, and waits for inclusion.
     *
     * Exists so integration tests can mirror the exact shape of the
     * production call site, where the frontend hands the JSON to the
     * user's real wallet and the wallet performs sign-and-send out of
     * process. In production the real wallet replaces this call
     * entirely; a production frontend never invokes
     * `WALLET_signAndSend`.
     *
     * Currently non-functional because `Transaction.fromJSON` does
     * not round-trip a proved transaction's `lazyAuthorization` (see
     * the class-level docstring). While this is blocked, split-stage
     * tests use `MOCK_computeMintProofAndCache` +
     * `WALLET_MOCK_signAndSendMintProofCache` instead, which pass the
     * proved transaction via an in-instance field rather than JSON.
     *
     * Not appropriate to call from production frontend code.
     *
     * @param provedTxJsonStr JSON string produced by
     *   `provedTx.toJSON()` inside a target-API method, transported
     *   back into the worker as a serialisation-safe string.
     * @returns An object carrying the submitted transaction's hash as
     *   `{ txHash }`.
     * @throws `Error` if `WALLET_setMinaPrivateKey` has not yet been
     *   called on this worker instance.
     */
    async WALLET_signAndSend(provedTxJsonStr: string) {
        if (!this.#minaPrivateKey)
            throw new Error(
                '#minaPrivateKey is undefined please call setMinaPrivateKey first'
            );
        const tx = Transaction.fromJSON(
            provedTxJsonStr
        ) as unknown as Mina.Transaction<true, false>;
        const result = await tx.sign([this.#minaPrivateKey]).send().wait();
        return { txHash: result.hash };
    }

    // ================================================================
    // Mina setup
    // ================================================================
    //
    // Installs a `Mina.Network` instance as the process-wide active
    // instance so every subsequent call on this worker (fetches,
    // transactions, waits) targets the configured network endpoints.
    // Must be called before any method that talks to the chain.

    /**
     * Configure and activate the Mina network that this worker will
     * target for every subsequent account fetch, transaction build,
     * and transaction submission. The new network becomes the
     * process-wide active instance via `Mina.setActiveInstance`.
     *
     * Must be called before any method that reads from or writes to
     * the chain (`needsToSetupStorage`, `setupStorage`, `mint`,
     * `getBalanceOf`, etc.). Safe to re-invoke to switch networks;
     * the latest call wins.
     *
     * @param options Plain-object configuration passed straight to
     *   `Mina.Network`:
     *   - `networkId`: optional Mina network id; defaults to the o1js
     *     default when omitted.
     *   - `mina`: single node URL or array of node URLs for the JSON
     *     RPC endpoint.
     *   - `archive`: single archive URL or array of archive URLs for
     *     historical action and event queries.
     *   - `lightnetAccountManager`: optional lightnet account-manager
     *     URL for local development networks.
     *   - `bypassTransactionLimits`: optional flag that relaxes o1js
     *     transaction-size limits, intended for local testing.
     *   - `minaDefaultHeaders`, `archiveDefaultHeaders`: optional
     *     default headers applied to every node / archive request
     *     (e.g. auth tokens).
     * @returns Resolves once the active instance has been installed.
     */
    async minaSetup(options: {
        networkId?: NetworkId;
        mina: string | string[];
        archive: string | string[];
        lightnetAccountManager?: string;
        bypassTransactionLimits?: boolean;
        minaDefaultHeaders?: HeadersInit;
        archiveDefaultHeaders?: HeadersInit;
    }) {
        const Network = Mina.Network(options);
        Mina.setActiveInstance(Network);
    }

    // ================================================================
    // Utilities
    // ================================================================
    //
    // Shared helpers used across tx-producing methods. Private to the
    // class and not reachable over the RPC surface.

    /**
     * Fetch the current on-chain state for a batch of accounts in
     * parallel, hydrating the o1js account cache so subsequent
     * `Mina.transaction` builds can read their state synchronously.
     * Tx-producing methods call this at entry against the accounts
     * they will read from or modify (typically the sender and the
     * `NoriTokenBridge` address, optionally under a specific tokenId
     * via direct `fetchAccount` calls elsewhere).
     *
     * Private helper: not reachable over the RPC surface.
     *
     * @param accounts Array of `PublicKey` instances to fetch. Each
     *   is fetched under the default tokenId; callers needing a
     *   non-default tokenId invoke `fetchAccount` directly rather
     *   than going through this helper.
     * @returns Resolves once every fetch has settled. Individual
     *   fetch failures propagate because `Promise.all` short-circuits
     *   on the first rejection.
     */
    private async fetchAccounts(accounts: PublicKey[]): Promise<void> {
        await Promise.all(
            accounts.map((addr) => fetchAccount({ publicKey: addr }))
        );
    }

    // ================================================================
    // Deposit attestation
    // ================================================================
    //
    // Thin worker-side wrapper around the deposit-attestation witness
    // builder. The witness proves, to the `NoriTokenBridge` circuit,
    // that a particular Ethereum deposit occurred at a particular
    // block and was bound to a specific SCRAM code challenge. The
    // heavy lifting lives in `../../depositAttestation.js`; this
    // method exists so the call can be made from the client over the
    // RPC surface with serialisation-safe inputs.

    /**
     * Compute the deposit-attestation witness for a given SCRAM code
     * challenge and deposit block, ready to be fed into the mint
     * circuit. Converts the serialisable code-challenge form into the
     * big-endian hex form that the attestor expects, then delegates
     * to `computeDepositAttestationWitness` from the depositAttestation
     * module.
     *
     * Safe to call from production frontend code.
     *
     * @param codeChallengeSCRAM Decimal string form of the SCRAM code
     *   challenge `Field`, as produced by `SCRAM_createCodeChallenge`.
     * @param depositBlockNumber Ethereum block number at which the
     *   deposit event was emitted. Used by the attestor to locate the
     *   deposit in the chain's action history.
     * @param domain Attestation-service domain used to look up the
     *   deposit proof. Defaults to the Nori production PCS endpoint;
     *   override for staging, local development, or test harnesses.
     * @returns The `MerkleTreeContractDepositAttestorInputJson` that
     *   serialises the witness for transport back over the RPC
     *   surface. Re-hydrated by `mint` / `MOCK_mint` via
     *   `buildMerkleTreeContractDepositAttestorInput`.
     */
    async computeDepositAttestationWitness(
        codeChallengeSCRAM: string,
        depositBlockNumber: number,
        domain = 'https://pcs.nori.it.com'
    ) {
        const codeChallengeBigInt = BigInt(codeChallengeSCRAM);
        const codeChallengeField = new Field(codeChallengeBigInt);
        const codeChallengeFieldBEHex =
            codeChallengeFieldToBEHex(codeChallengeField);
        return computeDepositAttestationWitness(
            depositBlockNumber,
            codeChallengeFieldBEHex,
            domain
        );
    }

    // ================================================================
    // Storage setup
    // ================================================================
    //
    // A user account's `NoriStorageInterface` subtree must be funded
    // and initialised once before it can participate in mints. This
    // section provides:
    //
    // - a read-only probe (`needsToSetupStorage`) that decides whether
    //   setup has already happened, used by clients to skip the step
    //   when it is not needed;
    // - the target public API (`setupStorage`) that builds and proves
    //   the setup transaction and returns it as JSON for an external
    //   wallet to sign and submit;
    // - a single-call test mock (`MOCK_setupStorage`) that signs and
    //   submits in-worker using the throwaway key from
    //   `WALLET_setMinaPrivateKey`. The mock goes away once
    //   `WALLET_signAndSend` is unblocked.

    /**
     * Probe whether the given Mina account needs its
     * `NoriStorageInterface` subtree set up for the given
     * `NoriTokenBridge`. Storage setup only needs to be done once per
     * account, so clients call this before `setupStorage` to decide
     * whether the setup step can be skipped. Fetches the storage
     * account under the
     * bridge's derived tokenId and checks for the presence of
     * `userKeyHash`; if fetch or read fails for any reason the probe
     * errs on the side of "setup is needed" so the caller will not
     * silently skip a required step. Also logs the current
     * `mintedSoFar` value when setup is already in place.
     *
     * Safe to call from production frontend code.
     * A `true` return means a subsequent `setupStorage` call is
     * required before the account can mint.
     *
     * @param noriTokenBridgeAddressBase58 Base58 address of the
     *   `NoriTokenBridge` zkApp whose storage subtree is being
     *   probed.
     * @param minaSenderPublicKeyBase58 Base58 public key of the
     *   Mina account being probed.
     * @returns `false` when the storage interface is already set up
     *   (userKeyHash present and readable); `true` when setup is
     *   needed or could not be confirmed.
     */
    async needsToSetupStorage(
        noriTokenBridgeAddressBase58: string,
        minaSenderPublicKeyBase58: string
    ) {
        try {
            const minaSenderPublicKey = PublicKey.fromBase58(
                minaSenderPublicKeyBase58
            );
            const noriTokenBridgeAddress = PublicKey.fromBase58(
                noriTokenBridgeAddressBase58
            );
            const noriTokenBridge = new NoriTokenBridge(noriTokenBridgeAddress);
            const storage = new NoriStorageInterface(
                minaSenderPublicKey,
                noriTokenBridge.deriveTokenId()
            );
            await fetchAccount({
                publicKey: minaSenderPublicKey,
                tokenId: noriTokenBridge.deriveTokenId(),
            });
            const userKeyHash = await storage.userKeyHash.fetch();
            if (!userKeyHash) throw new Error('userKeyHash was falsey');
            const mintedSoFar = await storage.mintedSoFar.fetch();
            logger.log('mintedSoFar', mintedSoFar.toBigInt());
            return false;
        } catch (e) {
            const error = e as Error;
            logger.log(
                `Error determining if we needed to setup storage. Going to assume that we do need to.`,
                error
            );
            // But perhaps this could error for other reasons?!
            return true;
        }
    }

    /**
     * Target public API for storage setup. Builds and proves the
     * setup transaction that funds and initialises the user's
     * `NoriStorageInterface` subtree under the given
     * `NoriTokenBridge`, then returns the proved transaction as a
     * JSON string for the user's real wallet (e.g. Auro) to sign and
     * submit. Sign-and-send happens outside this worker; this method
     * is the last worker call in the production storage-setup flow.
     *
     * Hydrates the user and bridge accounts via `fetchAccounts`
     * before building the transaction, funds a new on-chain account
     * for the storage subtree (`AccountUpdate.fundNewAccount`), and
     * invokes `NoriTokenBridge.setUpStorage` with the supplied
     * verification key.
     *
     * Safe to call from production frontend code.
     *
     * @param userPublicKeyBase58 Base58 public key of the user whose
     *   storage subtree is being set up. This account pays the fee
     *   and owns the new storage account update.
     * @param noriTokenBridgeAddressBase58 Base58 address of the
     *   `NoriTokenBridge` zkApp whose storage subtree is being
     *   initialised.
     * @param txFee Fee in nanomina for the setup transaction.
     * @param storageInterfaceVerificationKeySafe Serialisation-safe
     *   `NoriStorageInterface` verification key as returned by
     *   `compileMinterDeps` / `compileMinterDepsNoCache`
     *   (`{ data, hashStr }`). The `hashStr` decimal string is
     *   rehydrated back into a `Field` internally.
     * @returns JSON string produced by `provedTx.toJSON()` on the
     *   proved setup transaction. Fed to the user's real wallet (or,
     *   in tests, to `WALLET_signAndSend` once that is unblocked).
     */
    async setupStorage(
        userPublicKeyBase58: string,
        noriTokenBridgeAddressBase58: string,
        txFee: number,
        storageInterfaceVerificationKeySafe: { data: string; hashStr: string }
    ) {
        logger.log('userPublicKeyBase58', userPublicKeyBase58);
        const userPublicKey = PublicKey.fromBase58(userPublicKeyBase58);
        const noriTokenBridgeAddress = PublicKey.fromBase58(
            noriTokenBridgeAddressBase58
        );
        const { hashStr: storageInterfaceVerificationKeyHashStr, data } =
            storageInterfaceVerificationKeySafe;
        const storageInterfaceVerificationKeyHashBigInt = BigInt(
            storageInterfaceVerificationKeyHashStr
        );
        const hash = new Field(storageInterfaceVerificationKeyHashBigInt);
        const storageInterfaceVerificationKey = { data, hash };

        logger.log(`Setting up storage for user: ${userPublicKey.toBase58()}`);

        // DO we need to do this is we are not proving here???
        await this.fetchAccounts([userPublicKey, noriTokenBridgeAddress]);

        // Note we could have another method to not have to do this multiple times, but keeping it stateless for now.
        const noriTokenBridgeInst = new NoriTokenBridge(noriTokenBridgeAddress);

        const setupTx = await Mina.transaction(
            { sender: userPublicKey, fee: txFee },
            async () => {
                AccountUpdate.fundNewAccount(userPublicKey, 1);
                await noriTokenBridgeInst.setUpStorage(
                    userPublicKey,
                    storageInterfaceVerificationKey
                );
            }
        );

        const provedTx = await setupTx.prove();
        return provedTx.toJSON();
    }

    /**
     * End-to-end test substitute for `setupStorage`. Builds, proves,
     * signs and submits the setup transaction in one worker call
     * using the throwaway key installed by `WALLET_setMinaPrivateKey`,
     * then waits for inclusion and returns the tx hash.
     *
     * Exists only because `WALLET_signAndSend` is currently blocked by
     * the o1js `Transaction.fromJSON` issue; without it, specs have
     * no way to drive `setupStorage` + wallet-side sign-and-send as
     * two worker calls. Goes away once `WALLET_signAndSend` is
     * unblocked and tests migrate to `setupStorage` +
     * `WALLET_signAndSend`.
     *
     * Not appropriate to call from production frontend code.
     *
     * @param userPublicKeyBase58 Base58 public key of the user whose
     *   storage subtree is being set up. The throwaway key installed
     *   via `WALLET_setMinaPrivateKey` must correspond to this public
     *   key, since the mock signs with it.
     * @param noriTokenBridgeAddressBase58 Base58 address of the
     *   `NoriTokenBridge` zkApp whose storage subtree is being
     *   initialised.
     * @param txFee Fee in nanomina for the setup transaction.
     * @param storageInterfaceVerificationKeySafe
     *   `NoriStorageInterface` verification key in the
     *   `{ data, hashStr }` form returned by `compileMinterDeps` /
     *   `compileMinterDepsNoCache`.
     * @returns Object carrying the submitted transaction's hash as
     *   `{ txHash }` once the network has accepted and included it.
     */
    async MOCK_setupStorage(
        userPublicKeyBase58: string,
        noriTokenBridgeAddressBase58: string,
        txFee: number,
        storageInterfaceVerificationKeySafe: { data: string; hashStr: string }
    ) {
        logger.log('MOCK_setupStorage called with', {
            userPublicKeyBase58,
            noriTokenBridgeAddressBase58,
            txFee,
            storageInterfaceVerificationKeySafe,
        });
        const userPublicKey = PublicKey.fromBase58(userPublicKeyBase58);
        const noriTokenBridgeAddress = PublicKey.fromBase58(
            noriTokenBridgeAddressBase58
        );
        const { hashStr: storageInterfaceVerificationKeyHashStr, data } =
            storageInterfaceVerificationKeySafe;
        const storageInterfaceVerificationKeyHashBigInt = BigInt(
            storageInterfaceVerificationKeyHashStr
        );
        const hash = new Field(storageInterfaceVerificationKeyHashBigInt);
        const storageInterfaceVerificationKey = { data, hash };

        logger.log(`Setting up storage for user: ${userPublicKey.toBase58()}`);

        // DO we need to do this is we are not proving here???
        await this.fetchAccounts([userPublicKey, noriTokenBridgeAddress]);
        logger.log('fetched accounts');

        // Note we could have another method to not have to do this multiple times, but keeping it stateless for now.
        const noriTokenBridgeInst = new NoriTokenBridge(noriTokenBridgeAddress);
        logger.log('got token bridge inst');

        const setupTx = await Mina.transaction(
            { sender: userPublicKey, fee: txFee },
            async () => {
                AccountUpdate.fundNewAccount(userPublicKey, 1);
                await noriTokenBridgeInst.setUpStorage(
                    userPublicKey,
                    storageInterfaceVerificationKey
                );
            }
        );

        logger.log('setup tx');
        const provedTx = await setupTx.prove();
        logger.log('provedTx', provedTx);
        const tx = await provedTx.sign([this.#minaPrivateKey]).send();
        logger.log('sent');
        const result = await tx.wait();
        logger.log('result', result);
        logger.log('Storage setup completed successfully');
        return { txHash: result.hash };
    }

    // ================================================================
    // Balance queries
    // ================================================================
    //
    // Read-only lookups against the deployed contracts. No wallet
    // state is required and no transaction is built or submitted;
    // these exist so the client can render current on-chain state
    // (wrapped token balance, cumulative amount minted) over the RPC
    // surface.

    /**
     * Fetch the user's current balance of the wrapped fungible token
     * issued by the given `FungibleToken` zkApp. Hydrates the
     * balance-holding account under the token's derived tokenId, then
     * calls `FungibleToken.getBalanceOf` and returns the balance as a
     * decimal string of the raw on-chain value (nanounits of the
     * fungible token, equivalently the minted amount in the base
     * unit).
     *
     * Safe to call from production frontend code.
     *
     * @param noriTokenBaseBase58 Base58 address of the `FungibleToken`
     *   zkApp that issues the wrapped token being queried.
     * @param minaSenderPublicKeyBase58 Base58 public key of the
     *   account whose balance is being queried.
     * @returns Decimal string form of the balance in the token's raw
     *   on-chain units. Caller formats this for display.
     */
    async getBalanceOf(
        //noriTokenBridgeAddressBase58: string,
        noriTokenBaseBase58: string,
        minaSenderPublicKeyBase58: string
    ) {
        const minaSenderPublicKey = PublicKey.fromBase58(
            minaSenderPublicKeyBase58
        );
        const noriTokenBaseAddress = PublicKey.fromBase58(noriTokenBaseBase58);
        const noriTokenBase = new FungibleToken(noriTokenBaseAddress);
        /*const storage = new NoriStorageInterface(
            minaSenderPublicKey,
            noriTokenBridge.deriveTokenId()
        );*/
        await fetchAccount({
            publicKey: minaSenderPublicKey,
            tokenId: noriTokenBase.deriveTokenId(),
        });

        const balanceOf = await noriTokenBase.getBalanceOf(minaSenderPublicKey);

        logger.log('balanceOf raw', balanceOf);
        logger.log('balanceOf string', balanceOf.toString());

        return balanceOf.toBigInt().toString();
    }

    /**
     * Fetch the cumulative amount a given user has already minted
     * against the given `NoriTokenBridge`, as tracked by the user's
     * `NoriStorageInterface` subtree. Requires the storage subtree
     * to have been set up for the user (see `needsToSetupStorage` /
     * `setupStorage`); errors if it has not been.
     *
     * Safe to call from production frontend code.
     *
     * @param noriTokenBridgeAddressBase58 Base58 address of the
     *   `NoriTokenBridge` zkApp whose storage subtree is being read.
     * @param minaSenderPublicKeyBase58 Base58 public key of the user
     *   whose minted-so-far value is being queried.
     * @returns Decimal string form of the `mintedSoFar` field on the
     *   user's storage subtree.
     * @throws `Error` if the storage account's `userKeyHash` cannot
     *   be read, which typically indicates the account has not yet
     *   been set up.
     */
    async mintedSoFar(
        noriTokenBridgeAddressBase58: string,
        minaSenderPublicKeyBase58: string
    ) {
        const minaSenderPublicKey = PublicKey.fromBase58(
            minaSenderPublicKeyBase58
        );
        const noriTokenBridgeAddress = PublicKey.fromBase58(
            noriTokenBridgeAddressBase58
        );
        const noriTokenBridge = new NoriTokenBridge(noriTokenBridgeAddress);
        const storage = new NoriStorageInterface(
            minaSenderPublicKey,
            noriTokenBridge.deriveTokenId()
        );
        await fetchAccount({
            publicKey: minaSenderPublicKey,
            tokenId: noriTokenBridge.deriveTokenId(),
        });
        const userKeyHash = await storage.userKeyHash.fetch();
        if (!userKeyHash)
            throw new Error(
                'userKeyHash was falsey. Perhaps this account is not set up?'
            );
        const mintedSoFar = await storage.mintedSoFar.fetch();
        return mintedSoFar.toBigInt().toString();
    }

    // Update ******************************************************************************

    /**
     * @deprecated Deprecated in favour of tokenBridgeTester.update
     */
    async update(
        noriTokenBridgeAddressBase58: string,
        sp1PlonkProof: SP1ProofWithPublicValuesPlonkNoTee,
        proofData: ProofDataOutput,
        oldestActionStr: string,
        txFee: number
    ) {
        if (!this.#minaPrivateKey)
            throw new Error(
                '#minaPrivateKey is undefined please call setMinaPrivateKey first'
            );
        const senderPublicKey = this.#minaPrivateKey.toPublicKey();
        const noriTokenBridgeAddress = PublicKey.fromBase58(
            noriTokenBridgeAddressBase58
        );

        const decoded = decodeConsensusMptProof(sp1PlonkProof);
        const ethInput = new EthInput(decoded);
        const rawProof = await NodeProofLeft.fromJSON(proofData);
        const oldestAction = new Field(BigInt(oldestActionStr));

        logger.log(
            `Submitting update from sender: ${senderPublicKey.toBase58()}`
        );

        await this.fetchAccounts([senderPublicKey, noriTokenBridgeAddress]);

        const noriTokenBridgeInst = new NoriTokenBridge(noriTokenBridgeAddress);

        const updateTx = await Mina.transaction(
            { sender: senderPublicKey, fee: txFee },
            async () => {
                await noriTokenBridgeInst.update(
                    ethInput,
                    rawProof,
                    oldestAction
                );
            }
        );

        const provedTx = await updateTx.prove();
        return provedTx.toJSON();
    }

    // This will be removed when we have a working version of WALLET_signAndSend
    /**
     * @deprecated Deprecated in favour of tokenBridgeTester.update
     */
    async MOCK_update(
        noriTokenBridgeAddressBase58: string,
        sp1PlonkProof: SP1ProofWithPublicValuesPlonkNoTee,
        proofData: ProofDataOutput,
        oldestActionStr: string,
        txFee: number
    ) {
        if (!this.#minaPrivateKey)
            throw new Error(
                '#minaPrivateKey is undefined please call setMinaPrivateKey first'
            );
        const senderPublicKey = this.#minaPrivateKey.toPublicKey();
        const noriTokenBridgeAddress = PublicKey.fromBase58(
            noriTokenBridgeAddressBase58
        );

        const decoded = decodeConsensusMptProof(sp1PlonkProof);
        const ethInput = new EthInput(decoded);
        const rawProof = await NodeProofLeft.fromJSON(proofData);
        const oldestAction = new Field(BigInt(oldestActionStr));

        logger.log(
            `Submitting update from sender: ${senderPublicKey.toBase58()}`
        );

        const noriTokenBridgeInst = new NoriTokenBridge(noriTokenBridgeAddress);

        const updateTx = await Mina.transaction(
            { sender: senderPublicKey, fee: txFee },
            async () => {
                await noriTokenBridgeInst.update(
                    ethInput,
                    rawProof,
                    oldestAction
                );
            }
        );

        const provedTx = await updateTx.prove();
        const tx = await provedTx.sign([this.#minaPrivateKey]).send();
        const result = await tx.wait();
        logger.log('Update completed successfully');

        return { txHash: result.hash };
    }

    // ================================================================
    // Mint precheck
    // ================================================================

    /**
     * Decide whether the mint transaction should fund a new token
     * account for the sender via `AccountUpdate.fundNewAccount`. The
     * caller passes the resulting boolean straight into `mint` /
     * `MOCK_mint` as the `fundNewAccount` flag.
     *
     * Probes the sender's account under the given `FungibleToken`'s
     * derived tokenId. A missing account, or any error while
     * fetching, is taken as "needs funding" so the mint transaction
     * will create the account rather than fail on a missing
     * destination.
     *
     * Safe to call from production frontend code.
     *
     * @param noriTokenBaseBase58 Base58 address of the `FungibleToken`
     *   zkApp whose tokenId the sender will receive wrapped tokens
     *   under.
     * @param minaSenderPublicKeyBase58 Base58 public key of the
     *   account that will receive the minted tokens.
     * @returns `true` when the sender does not yet have an account
     *   under the token's tokenId (or when the probe failed); `false`
     *   when an existing account was found.
     */
    async needsToFundAccount(
        noriTokenBaseBase58: string,
        minaSenderPublicKeyBase58: string
    ) {
        const minaSenderPublicKey = PublicKey.fromBase58(
            minaSenderPublicKeyBase58
        );
        const noriTokenBaseAddress = PublicKey.fromBase58(noriTokenBaseBase58);
        const noriTokenBase = new FungibleToken(noriTokenBaseAddress);
        try {
            const fetchAccountResult = await fetchAccount({
                publicKey: minaSenderPublicKey,
                tokenId: noriTokenBase.deriveTokenId(),
            });
            logger.log(fetchAccountResult);

            if (fetchAccountResult.account === undefined) return true;
            return false;
        } catch (e: unknown) {
            logger.log(
                'We had an error fetching the account. We assume we need to fund it.',
                e instanceof Error ? e.stack : String(e)
            );
            return true;
        }
    }

    // ================================================================
    // Minter compilation
    // ================================================================
    //
    // Worker-side compilation of the three zkApp circuits the minter
    // depends on (`NoriStorageInterface`, `FungibleToken`,
    // `NoriTokenBridge`). Compilation is a prerequisite for every
    // tx-producing method in this worker and must happen once per
    // worker lifetime. Two implementations are retained:
    //
    // - `compileMinterDepsNoCache` compiles every circuit from source
    //   on every call. Currently the only working path.
    // - `compileMinterDeps` is the cache-aware entry point, intended
    //   to fetch prebuilt artefacts from a network cache server when
    //   running in the browser. Force-delegates to the no-cache path
    //   today because the o1js browser cache does not function
    //   reliably. The cache body below the early return is retained
    //   in full so it can be reactivated with a single edit once the
    //   upstream blocker is resolved.

    /**
     * Convert an o1js `VerificationKey` (carrying a `Field` hash) into
     * the `{ data, hashStr }` form that crosses the worker boundary.
     * `hashStr` is the hash's decimal-string representation, which
     * consumers rehydrate back into a `Field` via
     * `new Field(BigInt(hashStr))`.
     *
     * Private helper used by `compileMinterDeps` and
     * `compileMinterDepsNoCache` when packaging return values.
     *
     * @param vk o1js `VerificationKey` produced by contract
     *   compilation.
     * @returns `{ hashStr, data }` with `hashStr` as the decimal
     *   string form of `vk.hash` and `data` taken verbatim from the
     *   compiled key.
     */
    private vkToVkSafe(vk: VerificationKey) {
        const { data, hash } = vk;
        return {
            hashStr: hash.toBigInt().toString(),
            data,
        };
    }

    /**
     * Cache-aware entry point for compiling the three minter
     * dependencies. When the browser cache is functional this fetches
     * prebuilt artefacts for each circuit from the given
     * `cacheServer` and compiles against them; when not, it
     * delegates to `compileMinterDepsNoCache`.
     *
     * Currently force-delegates to `compileMinterDepsNoCache` on
     * every call regardless of `cacheServer`, because the o1js
     * browser compilation cache does not function reliably. The
     * cache-enabled body below the early return is retained in full
     * so it can be reactivated once the upstream issue is resolved;
     * do not remove it.
     *
     * Safe to call from production frontend code.
     *
     * @param cacheServer Optional base URL of a network cache server
     *   that exposes the prebuilt circuit artefacts laid out per
     *   `NoriStorageInterfaceCacheLayout`, `FungibleTokenCacheLayout`,
     *   and `NoriTokenBridgeCacheLayout`. Ignored while the cache
     *   path is disabled.
     * @returns `{ noriStorageInterfaceVerificationKeySafe,
     *   fungibleTokenVerificationKeySafe,
     *   noriTokenBridgeVerificationKeySafe }`, each in the
     *   `{ data, hashStr }` form produced by `vkToVkSafe`. Fed into
     *   `setupStorage` / `mint` at their verification-key parameter.
     */
    async compileMinterDeps(cacheServer?: string) {
        return this.compileMinterDepsNoCache(); // FORCE COMPILE WITHOUT CACHE AS O1JS browser cache does NOT work
        //if (!cacheServer || !isBrowser()) return this.compileMinterDepsNoCache();

        logger.log('Compiling all minter dependencies [Browser]...');

        // Now fetch caches in parallel
        const noriStorageInterfaceCache = cacheFactory({
            type: CacheType.Network,
            baseUrl: cacheServer,
            path: NoriStorageInterfaceCacheLayout.name,
            files: NoriStorageInterfaceCacheLayout.files,
        } as NetworkCacheConfig);
        const fungibleTokenCache = cacheFactory({
            type: CacheType.Network,
            baseUrl: cacheServer,
            path: FungibleTokenCacheLayout.name,
            files: FungibleTokenCacheLayout.files,
        } as NetworkCacheConfig);
        const noriTokenBridgeCache = cacheFactory({
            type: CacheType.Network,
            baseUrl: cacheServer,
            path: NoriTokenBridgeCacheLayout.name,
            files: NoriTokenBridgeCacheLayout.files,
        } as NetworkCacheConfig);

        // Compile contracts sequentially in dependency order
        const noriStorageInterfaceVks =
            await compileAndOptionallyVerifyContracts(
                logger,
                [
                    {
                        name: 'NoriStorageInterface',
                        program: NoriStorageInterface,
                        integrityHash: noriStorageInterfaceVkHash,
                    },
                ],
                await noriStorageInterfaceCache
            );
        const fungibleTokenVks = await compileAndOptionallyVerifyContracts(
            logger,
            [
                {
                    name: 'FungibleToken',
                    program: FungibleToken,
                    integrityHash: fungibleTokenVkHash,
                },
            ],
            await fungibleTokenCache
        );
        const noriTokenBridgeVks = await compileAndOptionallyVerifyContracts(
            logger,
            [
                {
                    name: 'NoriTokenBridge',
                    program: NoriTokenBridge,
                    integrityHash: noriTokenBridgeVkHash,
                },
            ],
            await noriTokenBridgeCache
        );

        const compiledVks: {
            NoriStorageInterfaceVerificationKey: VerificationKey;
            FungibleTokenVerificationKey: VerificationKey;
            NoriTokenBridgeVerificationKey: VerificationKey;
        } = {
            NoriStorageInterfaceVerificationKey:
                noriStorageInterfaceVks.NoriStorageInterfaceVerificationKey,
            FungibleTokenVerificationKey:
                fungibleTokenVks.FungibleTokenVerificationKey,
            NoriTokenBridgeVerificationKey:
                noriTokenBridgeVks.NoriTokenBridgeVerificationKey,
        };

        // Convert all verification keys to safe format
        const safeVks = {} as {
            [K in keyof typeof compiledVks]: { hashStr: string; data: string };
        };
        (Object.keys(compiledVks) as Array<keyof typeof compiledVks>).forEach(
            (key) => {
                safeVks[key] = this.vkToVkSafe(compiledVks[key]);
            }
        );

        logger.log('All minter dependency contracts compiled successfully.');

        // Return safe VKs
        return {
            noriStorageInterfaceVerificationKeySafe:
                safeVks.NoriStorageInterfaceVerificationKey,
            fungibleTokenVerificationKeySafe:
                safeVks.FungibleTokenVerificationKey,
            noriTokenBridgeVerificationKeySafe:
                safeVks.NoriTokenBridgeVerificationKey,
        };
    }

    /**
     * Cache-free fallback that compiles every minter dependency from
     * source on every call. Sequentially compiles
     * `NoriStorageInterface`, `FungibleToken`, and `NoriTokenBridge`
     * via `compileAndOptionallyVerifyContracts` and returns their
     * verification keys in serialisable form.
     *
     * Currently the only compilation path actually exercised because
     * `compileMinterDeps` force-delegates here. Deprecate this once
     * the o1js browser compilation cache is reliable.
     *
     * Safe to call from production frontend code.
     *
     * @returns `{ noriStorageInterfaceVerificationKeySafe,
     *   fungibleTokenVerificationKeySafe,
     *   noriTokenBridgeVerificationKeySafe }` in the
     *   `{ data, hashStr }` form produced by `vkToVkSafe`.
     */
    async compileMinterDepsNoCache() {
        logger.log('Compiling all minter dependencies...');

        const contracts = [
            {
                name: 'NoriStorageInterface',
                program: NoriStorageInterface,
                integrityHash: noriStorageInterfaceVkHash,
            },
            {
                name: 'FungibleToken',
                program: FungibleToken,
                integrityHash: fungibleTokenVkHash,
            },
            {
                name: 'NoriTokenBridge',
                program: NoriTokenBridge,
                integrityHash: noriTokenBridgeVkHash,
            },
        ] as const;

        // Compile all contracts
        const compiledVks = await compileAndOptionallyVerifyContracts(
            logger,
            contracts
        );

        // Convert all verification keys to safe format
        const safeVks = {} as {
            [K in keyof typeof compiledVks]: { hashStr: string; data: string };
        };

        (Object.keys(compiledVks) as Array<keyof typeof compiledVks>).forEach(
            (key) => {
                safeVks[key] = this.vkToVkSafe(compiledVks[key]);
            }
        );

        logger.log('All minter dependency contracts compiled successfully.');

        // Return the safe VKs along with the NoriStorageInterface hash string separately if needed
        return {
            noriStorageInterfaceVerificationKeySafe:
                safeVks.NoriStorageInterfaceVerificationKey,
            fungibleTokenVerificationKeySafe:
                safeVks.FungibleTokenVerificationKey,
            noriTokenBridgeVerificationKeySafe:
                safeVks.NoriTokenBridgeVerificationKey,
        };
    }

    // ================================================================
    // Mint
    // ================================================================
    //
    // Target public API and test scaffolding for the mint flow.
    //
    // - `mint` is the production target: build and prove a mint
    //   transaction, return it as a JSON string for the user's real
    //   wallet to sign and submit. The worker has no counterpart for
    //   the sign-and-send half.
    // - `MOCK_mint` is the end-to-end single-call test substitute,
    //   exactly analogous to `MOCK_setupStorage`. Goes away once
    //   `WALLET_signAndSend` is unblocked.
    // - `compileAll` is a convenience alias for `compileMinterDeps`
    //   kept alongside `mint` because it is the compile call the mint
    //   flow actually invokes.

    /**
     * Target public API for mint. Builds and proves the mint
     * transaction that credits the user with wrapped tokens
     * corresponding to a previously-attested Ethereum deposit, then
     * returns the proved transaction as a JSON string for the user's
     * real wallet (e.g. Auro) to sign and submit. Sign-and-send
     * happens outside this worker; this method is the last worker
     * call in the production mint flow.
     *
     * Rehydrates the deposit-attestation witness and the SCRAM
     * message / signature from their serialised forms, hydrates the
     * user and bridge accounts via `fetchAccounts`, conditionally
     * funds a new token account for the user when `fundNewAccount`
     * is true, and invokes `NoriTokenBridge.noriMint` with the
     * witnesses.
     *
     * Safe to call from production frontend code.
     *
     * @param userPublicKeyBase58 Base58 public key of the user
     *   receiving the minted tokens. Pays the fee.
     * @param noriTokenBridgeAddressBase58 Base58 address of the
     *   `NoriTokenBridge` zkApp performing the mint.
     * @param merkleTreeContractDepositAttestorInputJson
     *   Serialised deposit-attestation witness as produced by
     *   `computeDepositAttestationWitness`.
     * @param messageSCRAMStr SCRAM message as a string, rehydrated
     *   internally into a `CircuitString` and then field array.
     * @param signatureSCRAMBase58 Base58-encoded Mina `Signature`
     *   over the SCRAM message by the user's wallet key.
     * @param txFee Fee in nanomina for the mint transaction.
     * @param fundNewAccount When true, the transaction includes an
     *   `AccountUpdate.fundNewAccount` for the user under the token's
     *   derived tokenId. Driven by `needsToFundAccount`.
     * @returns JSON string produced by `provedTx.toJSON()` on the
     *   proved mint transaction. Fed to the user's real wallet (or,
     *   in tests, to `WALLET_signAndSend` once that is unblocked).
     */
    async mint(
        userPublicKeyBase58: string,
        noriTokenBridgeAddressBase58: string,
        merkleTreeContractDepositAttestorInputJson: MerkleTreeContractDepositAttestorInputJson,
        messageSCRAMStr: string,
        signatureSCRAMBase58: string,
        txFee: number,
        fundNewAccount: boolean
    ) {
        const userPublicKey = PublicKey.fromBase58(userPublicKeyBase58);
        const noriTokenBridgeAddress = PublicKey.fromBase58(
            noriTokenBridgeAddressBase58
        );

        // Reconstruct deposit input
        const merkleTreeContractDepositAttestorInput =
            buildMerkleTreeContractDepositAttestorInput(
                merkleTreeContractDepositAttestorInputJson
            );

        // Reconstruct SCRAMMessage
        const msgCS = CircuitString.fromString(messageSCRAMStr);
        const msgSCRAM = msgCS.values.map((char) => char.toField());

        // Reconstruct signatureSCRAM
        const signatureSCRAM = Signature.fromBase58(signatureSCRAMBase58);

        // Reconstruct witness for scram
        const witnessSCRAM = new SCRAMWitness({
            message: msgSCRAM,
            signature: signatureSCRAM,
        });

        logger.log(`Minting tokens for user: ${userPublicKeyBase58}`);

        //await fetchAccount({ publicKey: userPublicKey }); // DO we need to do this is we are not proving here???
        await this.fetchAccounts([userPublicKey, noriTokenBridgeAddress]);

        // Note we could have another method to not have to do this multiple times, but keeping it stateless for now.
        const noriTokenBridgeInst = new NoriTokenBridge(noriTokenBridgeAddress);

        const mintTx = await Mina.transaction(
            { sender: userPublicKey, fee: txFee },
            async () => {
                if (fundNewAccount) {
                    AccountUpdate.fundNewAccount(userPublicKey, 1);
                }
                await noriTokenBridgeInst.noriMint(
                    merkleTreeContractDepositAttestorInput,
                    witnessSCRAM
                );
            }
        );

        const provedTx = await mintTx.prove();

        return provedTx.toJSON();
    }

    /**
     * End-to-end test substitute for `mint`. Builds, proves, signs
     * and submits the mint transaction in one worker call using the
     * throwaway key installed by `WALLET_setMinaPrivateKey`, then
     * waits for inclusion and returns the tx hash.
     *
     * Exists only because `WALLET_signAndSend` is currently blocked
     * by the o1js `Transaction.fromJSON` issue; without it, specs
     * have no way to drive `mint` + wallet-side sign-and-send as two
     * worker calls. Goes away once `WALLET_signAndSend` is unblocked
     * and tests migrate to `mint` + `WALLET_signAndSend`.
     *
     * Not appropriate to call from production frontend code.
     *
     * @param userPublicKeyBase58 Base58 public key of the user
     *   receiving the minted tokens. The throwaway key installed via
     *   `WALLET_setMinaPrivateKey` must correspond to this public
     *   key, since the mock signs with it.
     * @param noriTokenBridgeAddressBase58 Base58 address of the
     *   `NoriTokenBridge` zkApp performing the mint.
     * @param merkleTreeContractDepositAttestorInputJson
     *   Serialised deposit-attestation witness as produced by
     *   `computeDepositAttestationWitness`.
     * @param messageSCRAMStr SCRAM message as a string.
     * @param signatureSCRAMBase58 Base58-encoded SCRAM signature.
     * @param txFee Fee in nanomina for the mint transaction.
     * @param fundNewAccount When true, the transaction includes an
     *   `AccountUpdate.fundNewAccount` for the user under the
     *   token's derived tokenId.
     * @returns Object carrying the submitted transaction's hash as
     *   `{ txHash }` once the network has accepted and included it.
     */
    async MOCK_mint(
        userPublicKeyBase58: string,
        noriTokenBridgeAddressBase58: string,
        merkleTreeContractDepositAttestorInputJson: MerkleTreeContractDepositAttestorInputJson,
        messageSCRAMStr: string,
        signatureSCRAMBase58: string,
        txFee: number,
        fundNewAccount: boolean
    ) {
        const userPublicKey = PublicKey.fromBase58(userPublicKeyBase58);
        const noriTokenBridgeAddress = PublicKey.fromBase58(
            noriTokenBridgeAddressBase58
        );

        // Reconstruct deposit input
        const merkleTreeContractDepositAttestorInput =
            buildMerkleTreeContractDepositAttestorInput(
                merkleTreeContractDepositAttestorInputJson
            );

        // Reconstruct SCRAMMessage
        const msgCS = CircuitString.fromString(messageSCRAMStr);
        const msgSCRAM = msgCS.values.map((char) => char.toField());

        // Reconstruct signatureSCRAM
        const signatureSCRAM = Signature.fromBase58(signatureSCRAMBase58);

        // Reconstruct witness for scram
        const witnessSCRAM = new SCRAMWitness({
            message: msgSCRAM,
            signature: signatureSCRAM,
        });

        logger.log(`Minting tokens for user: ${userPublicKeyBase58}`);

        //await fetchAccount({ publicKey: userPublicKey }); // DO we need to do this is we are not proving here???

        // Note we could have another method to not have to do this multiple times, but keeping it stateless for now.
        const noriTokenBridgeInst = new NoriTokenBridge(noriTokenBridgeAddress);

        const mintTx = await Mina.transaction(
            { sender: userPublicKey, fee: txFee },
            async () => {
                if (fundNewAccount) {
                    AccountUpdate.fundNewAccount(userPublicKey, 1);
                }
                await noriTokenBridgeInst.noriMint(
                    merkleTreeContractDepositAttestorInput,
                    witnessSCRAM
                );
            }
        );

        const provedTx = await mintTx.prove();
        const tx = await provedTx.sign([this.#minaPrivateKey]).send();
        const result = await tx.wait();
        logger.log('Minting completed successfully');

        return { txHash: result.hash };
    }

    /**
     * Convenience alias for `compileMinterDeps`. Kept alongside the
     * mint methods because the mint flow is the compilation's only
     * consumer; client code that wants the whole worker ready to go
     * calls `compileAll` rather than threading through the more
     * specific `compileMinterDeps` name.
     *
     * Safe to call from production frontend code.
     *
     * @param cacheServer Optional base URL of a network cache server;
     *   forwarded verbatim to `compileMinterDeps`. Ignored while the
     *   browser cache path is disabled.
     * @returns The same `{ noriStorageInterfaceVerificationKeySafe,
     *   fungibleTokenVerificationKeySafe,
     *   noriTokenBridgeVerificationKeySafe }` shape returned by
     *   `compileMinterDeps`.
     */
    async compileAll(cacheServer?: string) {
        return this.compileMinterDeps(cacheServer);
    }

    // ================================================================
    // Split-stage mint (test-only)
    // ================================================================
    //
    // Two-call test scaffolding that mirrors the production call
    // shape at the spec level: a prove half and a sign-and-send half,
    // with the proved transaction passed between them.
    //
    // `MOCK_computeMintProofAndCache` builds and proves the mint
    // transaction and stores it on the instance in `#mintProofCache`;
    // `WALLET_MOCK_signAndSendMintProofCache` then signs that cached
    // transaction with the throwaway key and submits it. The handoff
    // is via an in-instance field rather than JSON, which sidesteps
    // the o1js `Transaction.fromJSON` blocker. When that blocker is
    // fixed, specs migrate to `mint` + `WALLET_signAndSend`, which is
    // the same two-call shape but with JSON on the wire.
    //
    // Both methods are test-only.

    #mintProofCache: Mina.Transaction<true, false>;

    /**
     * Prove half of the split-stage mint mock. Builds and proves the
     * mint transaction identically to `mint`, then stores the proved
     * `Mina.Transaction` on the instance in `#mintProofCache` for a
     * subsequent `WALLET_MOCK_signAndSendMintProofCache` call to sign
     * and submit. Returns nothing over the RPC surface; the proved
     * transaction never crosses the worker boundary because
     * `Mina.Transaction` is not serialisation-safe (this is the same
     * reason `WALLET_signAndSend` is blocked).
     *
     * Overwrites any previously cached proof on the same worker
     * instance, so pairs one-to-one with a following
     * `WALLET_MOCK_signAndSendMintProofCache` call.
     *
     * Not appropriate to call from production frontend code.
     *
     * @param userPublicKeyBase58 Base58 public key of the user
     *   receiving the minted tokens.
     * @param noriTokenBridgeAddressBase58 Base58 address of the
     *   `NoriTokenBridge` zkApp performing the mint.
     * @param merkleTreeContractDepositAttestorInputJson
     *   Serialised deposit-attestation witness as produced by
     *   `computeDepositAttestationWitness`.
     * @param messageSCRAMStr SCRAM message as a string.
     * @param signatureSCRAMBase58 Base58-encoded SCRAM signature.
     * @param txFee Fee in nanomina for the mint transaction.
     * @param fundNewAccount When true, the transaction includes an
     *   `AccountUpdate.fundNewAccount` for the user under the
     *   token's derived tokenId.
     * @returns Resolves once the proof has been computed and cached.
     */
    async MOCK_computeMintProofAndCache(
        userPublicKeyBase58: string,
        noriTokenBridgeAddressBase58: string,
        merkleTreeContractDepositAttestorInputJson: MerkleTreeContractDepositAttestorInputJson,
        messageSCRAMStr: string,
        signatureSCRAMBase58: string,
        txFee: number,
        fundNewAccount: boolean
        //fundNewAccount = true
    ) {
        const userPublicKey = PublicKey.fromBase58(userPublicKeyBase58);
        const noriTokenBridgeAddress = PublicKey.fromBase58(
            noriTokenBridgeAddressBase58
        );

        // Reconstruct deposit input
        const merkleTreeContractDepositAttestorInput =
            buildMerkleTreeContractDepositAttestorInput(
                merkleTreeContractDepositAttestorInputJson
            );

        // Reconstruct SCRAMMessage
        const msgCS = CircuitString.fromString(messageSCRAMStr);
        const msgSCRAM = msgCS.values.map((char) => char.toField());

        // Reconstruct signatureSCRAM
        const signatureSCRAM = Signature.fromBase58(signatureSCRAMBase58);

        // Reconstruct witness for scram
        const witnessSCRAM = new SCRAMWitness({
            message: msgSCRAM,
            signature: signatureSCRAM,
        });

        logger.log(`Minting tokens for user: ${userPublicKeyBase58}`);

        //await fetchAccount({ publicKey: userPublicKey }); // DO we need to do this is we are not proving here???
        await this.fetchAccounts([userPublicKey, noriTokenBridgeAddress]);

        // Note we could have another method to not have to do this multiple times, but keeping it stateless for now.
        const noriTokenBridgeInst = new NoriTokenBridge(noriTokenBridgeAddress);

        const mintTx = await Mina.transaction(
            { sender: userPublicKey, fee: txFee },
            async () => {
                if (fundNewAccount) {
                    AccountUpdate.fundNewAccount(userPublicKey, 1);
                }
                await noriTokenBridgeInst.noriMint(
                    merkleTreeContractDepositAttestorInput,
                    witnessSCRAM
                );
            }
        );

        const provedTx = await mintTx.prove();

        this.#mintProofCache = provedTx;
    }

    /**
     * Sign-and-send half of the split-stage mint mock. Signs the
     * `Mina.Transaction` that `MOCK_computeMintProofAndCache` left in
     * `#mintProofCache` using the throwaway key installed by
     * `WALLET_setMinaPrivateKey`, submits it, and waits for
     * inclusion.
     *
     * Mirrors what `WALLET_signAndSend` will do once the o1js
     * `Transaction.fromJSON` blocker is resolved: the two-call shape
     * at the spec level is the same, only the handoff between calls
     * differs (in-instance field here, JSON there).
     *
     * Not appropriate to call from production frontend code. Must be
     * preceded by a `MOCK_computeMintProofAndCache` call on the same
     * worker instance; calling without a prior prove will throw a
     * null-dereference inside o1js.
     *
     * @returns Object carrying the submitted transaction's hash as
     *   `{ txHash }` once the network has accepted and included it.
     */
    async WALLET_MOCK_signAndSendMintProofCache() {
        const signedTx = this.#mintProofCache.sign([this.#minaPrivateKey]);
        logger.log('signedTx...sending', signedTx);
        const tx = await signedTx.send();
        logger.log('Sent tx...waiting', tx);
        const result = await tx.wait();
        logger.log('Awaited tx');
        return { txHash: result.hash };
    }

    // ================================================================
    // SCRAM helpers
    // ================================================================
    //
    // Worker-side wrappers around the pure SCRAM primitives in
    // `../../scram.js`. The `SCRAM_`-prefixed methods are safe in
    // production code (no wallet state required, every parameter is
    // a decimal string or base58). `MOCK_SCRAM_signMessage` requires
    // the throwaway worker key and so is test-only; production code
    // must sign SCRAM messages with the user's real wallet.

    /**
     * Create the SCRAM code challenge from a base58-encoded Mina
     * signature (the "code verifier" in SCRAM parlance). Thin
     * worker-side wrapper around `createCodeChallenge`.
     *
     * Safe to call from production frontend code.
     *
     * @param signatureSCRAMBase58 Base58-encoded Mina `Signature`
     *   that plays the role of the code verifier.
     * @returns Decimal string form of the resulting `Field`, suitable
     *   as input to `computeDepositAttestationWitness` /
     *   `SCRAM_codeChallengeToBEHex`.
     */
    async SCRAM_createCodeChallenge(signatureSCRAMBase58: string) {
        // Reconstruct signatureSCRAM
        const codeVerifier = Signature.fromBase58(signatureSCRAMBase58);
        // Create code challenge
        const codeChallenge = createCodeChallenge(codeVerifier);
        // Return serialized form
        return codeChallenge.toBigInt().toString();
    }

    /**
     * Convert a SCRAM code-challenge `Field` into its big-endian hex
     * string representation, as required by the
     * deposit-attestation service. Thin worker-side wrapper around
     * `codeChallengeFieldToBEHex`.
     *
     * Safe to call from production frontend code.
     *
     * @param codeChallengeStr Decimal string form of the code
     *   challenge `Field`, as produced by `SCRAM_createCodeChallenge`.
     * @returns `0x`-prefixed big-endian hex string form of the code
     *   challenge, ready to be fed to the attestation service.
     */
    async SCRAM_codeChallengeToBEHex(codeChallengeStr: string) {
        const codeChallenge = new Field(BigInt(codeChallengeStr));
        return codeChallengeFieldToBEHex(codeChallenge); // 0x-prefixed hex
    }

    /**
     * Sign a message with the throwaway key installed by
     * `WALLET_setMinaPrivateKey`, producing a SCRAM signature
     * suitable as the `signatureSCRAMBase58` input to `mint` /
     * `MOCK_mint` / `MOCK_computeMintProofAndCache`.
     *
     * Exists so tests can produce SCRAM signatures without a real
     * wallet. Not appropriate to call from production frontend code:
     * production SCRAM signing happens in the user's real wallet,
     * never in the worker.
     *
     * @param messageToSign Plain string to sign. Converted to a
     *   `CircuitString` and then to a field array before signing.
     * @returns Base58-encoded Mina `Signature` over the message
     *   fields, ready to be passed back into mint-flow methods.
     */
    async MOCK_SCRAM_signMessage(messageToSign: string) {
        const cs = CircuitString.fromString(messageToSign);
        const csFields = cs.values.map((char) => char.toField());
        const signature = Signature.create(this.#minaPrivateKey, csFields);
        return signature.toBase58();
    }
}
