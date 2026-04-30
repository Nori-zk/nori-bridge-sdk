import { Logger, LogPrinter } from 'esm-iso-logger';
import {
    cacheFactory,
    CacheType,
    compileAndOptionallyVerifyContracts,
    type NetworkCacheConfig,
    vkToVkSafe,
} from '@nori-zk/o1js-zk-utils';
import {
    AccountUpdate,
    CircuitString,
    fetchAccount,
    Mina,
    type NetworkId,
    PrivateKey,
    PublicKey,
    Signature,
} from 'o1js';
import { NoriStorageInterface } from '../../NoriStorageInterface.js';
import { FungibleToken } from '../../TokenBase.js';
import { NoriTokenBridge } from '../../NoriTokenBridge.js';
import {
    buildMerkleTreeContractDepositAttestorInput,
    type MerkleTreeContractDepositAttestorInputJson,
} from '../../depositAttestation.js';
import { SCRAMWitness } from '../../scram.js';
import { noriStorageInterfaceVkHash } from '../../integrity/NoriStorageInterface.VkHash.js';
import { fungibleTokenVkHash } from '../../integrity/FungibleToken.VkHash.js';
import { noriTokenBridgeVkHash } from '../../integrity/NoriTokenBridge.VkHash.js';
import {
    NoriStorageInterfaceCacheLayout,
    FungibleTokenCacheLayout,
    NoriTokenBridgeCacheLayout,
} from '../../cache-layouts/index.js';

new LogPrinter('TokenBridgeMintWorker');
const logger = new Logger('TokenBridgeMintWorker');

// NOTE: explicit `globalThis.gc()` calls were tried here and removed —
// they trigger wasm-bindgen `FinalizationRegistry` cleanup at points
// the o1js runtime doesn't expect, which surfaced as
// `__wbg_wasmfpplonkverifierindex_free` failing with
// "operation does not support unaligned accesses" during prove().
// Don't reintroduce without a deterministic way to scope which
// objects are eligible.

// Best-effort heap-usage snapshot. `performance.memory` is Chromium-only
// and only present in secure contexts; `performance.measureUserAgentSpecificMemory`
// is the cross-engine modern API (also Chromium-only today). Returns a
// plain object suitable for logging or a string fallback.
async function reportMemory(label: string) {
    try {
        const perf = (
            globalThis as unknown as {
                performance?: {
                    memory?: {
                        usedJSHeapSize: number;
                        totalJSHeapSize: number;
                        jsHeapSizeLimit: number;
                    };
                    measureUserAgentSpecificMemory?: () => Promise<unknown>;
                };
            }
        ).performance;
        const memory = perf?.memory;
        if (memory) {
            logger.log(
                `[mem] ${label} used=${(memory.usedJSHeapSize / 1024 / 1024).toFixed(0)}MB total=${(memory.totalJSHeapSize / 1024 / 1024).toFixed(0)}MB limit=${(memory.jsHeapSizeLimit / 1024 / 1024).toFixed(0)}MB`
            );
        }
        if (perf?.measureUserAgentSpecificMemory) {
            const detail = await perf.measureUserAgentSpecificMemory();
            logger.log(`[mem] ${label} measureUASpecificMemory:`, detail);
        }
    } catch (e) {
        logger.log(`[mem] ${label} memory report failed`, e);
    }
}

/**
 * # TokenBridgeMintWorker
 *
 * Minimal off-main-thread o1js worker that owns ONLY the mint-half of
 * the bridge flow: compile the minter dependency circuits, build and
 * prove a mint transaction (`MOCK_computeMintProofAndCache`), then
 * sign and submit it with a wallet-emulating throwaway key
 * (`WALLET_MOCK_signAndSendMintProofCache`).
 *
 * Carved out of `TokenBridgeWorker` so a fresh worker can be spawned
 * specifically for the mint computation, which is the OOM-prone half
 * of the flow. Contains no deposit-attestation, storage-setup,
 * balance-query, or update logic -- those stay in the full
 * `TokenBridgeWorker`.
 *
 * Mirrors the RPC / serialisation conventions of `TokenBridgeWorker`:
 * every public method's parameters and return value are
 * serialisation-safe; class instances (`Field`, `PublicKey`,
 * `Signature`, `Mina.Transaction`, `VerificationKey`) are reconstructed
 * at call entry and never cross the worker boundary.
 *
 * The split-stage handoff (`#mintProofCache`) is identical to the one
 * in `TokenBridgeWorker`: the proved transaction is held on the
 * instance because o1js cannot round-trip `lazyAuthorization` through
 * `Transaction.fromJSON`.
 */
export class TokenBridgeMintWorker {
    #minaPrivateKey: PrivateKey;
    #mintProofCache: Mina.Transaction<true, false>;

    /**
     * Inject the throwaway Mina private key used by
     * `WALLET_MOCK_signAndSendMintProofCache` to sign the cached mint
     * transaction. Must be called exactly once per worker instance.
     */
    async WALLET_setMinaPrivateKey(minaPrivateKeyBase58: string) {
        if (this.#minaPrivateKey)
            throw new Error('Mina private key has already been set.');
        this.#minaPrivateKey = PrivateKey.fromBase58(minaPrivateKeyBase58);
    }

    /**
     * Configure and activate the Mina network for every subsequent
     * fetch and transaction in this worker. Must be called before
     * `MOCK_computeMintProofAndCache` /
     * `WALLET_MOCK_signAndSendMintProofCache`.
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

    private async fetchAccounts(accounts: PublicKey[]): Promise<void> {
        await Promise.all(
            accounts.map((addr) => fetchAccount({ publicKey: addr }))
        );
    }

    /**
     * Compile the three circuits the mint flow depends on
     * (`NoriStorageInterface`, `FungibleToken`, `NoriTokenBridge`).
     * Required once per worker lifetime before
     * `MOCK_computeMintProofAndCache`.
     *
     * Cache-free: matches the only path actually exercised in
     * `TokenBridgeWorker.compileMinterDepsNoCache`. The browser
     * compilation cache is disabled upstream and not replicated here.
     */
    async compileAll(cacheServer?: string) {
        if (cacheServer) {
            return this.compileAllNetworkCached(cacheServer);
        }
        return this.compileAllNoCache();
    }

    private async compileAllNoCache() {
        logger.log('Compiling all minter dependencies (no cache)...');
        await reportMemory('compileAll:before');

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

        const compiledVks = await compileAndOptionallyVerifyContracts(
            logger,
            contracts
        );

        logger.log('All minter dependency contracts compiled successfully.');
        await reportMemory('compileAll:after');

        return {
            noriStorageInterfaceVerificationKeySafe: vkToVkSafe(
                compiledVks.NoriStorageInterfaceVerificationKey
            ),
            fungibleTokenVerificationKeySafe: vkToVkSafe(
                compiledVks.FungibleTokenVerificationKey
            ),
            noriTokenBridgeVerificationKeySafe: vkToVkSafe(
                compiledVks.NoriTokenBridgeVerificationKey
            ),
        };
    }

    /**
     * Cache-aware compile. `cacheServer` is the base URL where the
     * pre-baked artifacts live. The network cache fetches each
     * file + its `.header` from
     *   `<cacheServer>/<ContractName>/<file>` and `<...>.header`
     * matching the layout produced by the contracts/mina
     * `build:cache-layouts` script (which writes to
     * `<repo>/cache-server/cache/<ContractName>/`). Each contract is
     * compiled with its own cache instance so o1js can short-circuit
     * the heavy prover-key computation.
     *
     * Cache reduces compile *time*, not steady-state memory: once
     * loaded, prover keys still occupy WASM memory. Wired up so the
     * dev loop is faster and so the underlying cache infra can be
     * verified end-to-end in the browser.
     */
    private async compileAllNetworkCached(cacheServer: string) {
        logger.log(
            `Compiling all minter dependencies via network cache @ ${cacheServer}`
        );
        await reportMemory('compileAll:before');

        // Load + use + drop each cache one at a time. Holding all
        // three cache maps in scope through the third compile is
        // ~1 GB of unnecessary JS heap on top of the prover keys.
        const compileOne = async <K extends string>(
            layoutName: K,
            files: string[],
            program:
                | typeof NoriStorageInterface
                | typeof FungibleToken
                | typeof NoriTokenBridge,
            integrityHash: string
        ) => {
            const cache = await cacheFactory({
                type: CacheType.Network,
                baseUrl: cacheServer,
                path: layoutName,
                files,
            } as NetworkCacheConfig);
            const vks = await compileAndOptionallyVerifyContracts(
                logger,
                [{ name: layoutName, program, integrityHash }],
                cache
            );
            return vks[`${layoutName}VerificationKey` as const];
        };

        const noriStorageInterfaceVk = await compileOne(
            NoriStorageInterfaceCacheLayout.name,
            NoriStorageInterfaceCacheLayout.files,
            NoriStorageInterface,
            noriStorageInterfaceVkHash
        );
        await reportMemory('compileAll:after-NoriStorageInterface');
        const fungibleTokenVk = await compileOne(
            FungibleTokenCacheLayout.name,
            FungibleTokenCacheLayout.files,
            FungibleToken,
            fungibleTokenVkHash
        );
        await reportMemory('compileAll:after-FungibleToken');
        const noriTokenBridgeVk = await compileOne(
            NoriTokenBridgeCacheLayout.name,
            NoriTokenBridgeCacheLayout.files,
            NoriTokenBridge,
            noriTokenBridgeVkHash
        );
        await reportMemory('compileAll:after-NoriTokenBridge');

        logger.log('All minter dependency contracts compiled (cached).');

        return {
            noriStorageInterfaceVerificationKeySafe:
                vkToVkSafe(noriStorageInterfaceVk),
            fungibleTokenVerificationKeySafe: vkToVkSafe(fungibleTokenVk),
            noriTokenBridgeVerificationKeySafe: vkToVkSafe(noriTokenBridgeVk),
        };
    }

    /**
     * Prove half of the split-stage mint mock. Builds and proves the
     * mint transaction, then stores the proved `Mina.Transaction` on
     * the instance in `#mintProofCache` for a subsequent
     * `WALLET_MOCK_signAndSendMintProofCache` call to sign and submit.
     * The proved transaction never crosses the worker boundary because
     * `Mina.Transaction` is not serialisation-safe.
     */
    async MOCK_computeMintProofAndCache(
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

        const merkleTreeContractDepositAttestorInput =
            buildMerkleTreeContractDepositAttestorInput(
                merkleTreeContractDepositAttestorInputJson
            );

        const msgCS = CircuitString.fromString(messageSCRAMStr);
        const msgSCRAM = msgCS.values.map((char) => char.toField());

        const signatureSCRAM = Signature.fromBase58(signatureSCRAMBase58);

        const witnessSCRAM = new SCRAMWitness({
            message: msgSCRAM,
            signature: signatureSCRAM,
        });

        logger.log(`Minting tokens for user: ${userPublicKeyBase58}`);

        await this.fetchAccounts([userPublicKey, noriTokenBridgeAddress]);

        const noriTokenBridgeInst = new NoriTokenBridge(noriTokenBridgeAddress);

        await reportMemory('mint:before-build');
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
        await reportMemory('mint:after-build');

        logger.log('Calling mintTx.prove()');
        const provedTx = await mintTx.prove();
        await reportMemory('mint:after-prove');

        this.#mintProofCache = provedTx;
    }

    /**
     * Sign-and-send half of the split-stage mint mock. Signs the
     * cached `Mina.Transaction` left by
     * `MOCK_computeMintProofAndCache` using the throwaway key
     * installed by `WALLET_setMinaPrivateKey`, submits it, and waits
     * for inclusion. Must be preceded by a
     * `MOCK_computeMintProofAndCache` call on the same worker
     * instance.
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

    /**
     * Read the user's wrapped-token balance under the given
     * `FungibleToken` zkApp. Read-only post-mint check.
     */
    async getBalanceOf(
        noriTokenBaseBase58: string,
        minaSenderPublicKeyBase58: string
    ) {
        const minaSenderPublicKey = PublicKey.fromBase58(
            minaSenderPublicKeyBase58
        );
        const noriTokenBaseAddress = PublicKey.fromBase58(noriTokenBaseBase58);
        const noriTokenBase = new FungibleToken(noriTokenBaseAddress);
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
     * Read the cumulative amount the user has already minted against
     * the given `NoriTokenBridge` from their `NoriStorageInterface`
     * subtree. Read-only post-mint check; requires the storage
     * subtree to be set up (errors if not).
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
}
