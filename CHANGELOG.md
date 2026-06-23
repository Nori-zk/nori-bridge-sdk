# Changelog

## 23/6/26 - Finding 7f3a1: codeChallenge is unnecessarily bound to msg.sender in lockTokens

### Finding (verbatim)

Hey team, I want to double-check the reasoning for binding codeChallenge to msg.sender on the Ethereum side in lockTokens.
Could you clarify why this is required? Have you considered not binding codeChallenge to a single depositor and allowing anyone to deposit to that codeChallenge?
Potential advantages of not binding are better liveness and UX (it eliminates mempool front-run grief revert), but there may be stronger reasons to keep the single-owner deposit-key invariant.

### Discussion

The design went through two iterations. In the earlier iteration codeChallenge was derived from an Ethereum signature and a Mina public key. After the latest redesign the Mina signature was adopted, which produces a deterministic signature for a given message. The msg.sender binding was left in the contract as a result of cognitive bias carried over from the prior design. After careful review it was agreed internally that the binding is no longer required.

The auditors confirmed that it can be removed without any impact.

The original constraint existed because codeChallenge previously incorporated both keys, which required an additional constraint to ensure correct accounting for cumulative lockedTokens.

### Response

We agree and will relax the constraint.

### Commit 1 - Regression test exposing the undesirable depositor binding

`contracts/ethereum/test/NoriTokenBridge.ts` contained a test `Should bind Mina account to first depositor and reject others` asserting that a second depositor calling lockTokens with a codeChallenge already used by a different address is rejected with MinaAccountLinkedToDifferentDepositor. Prior to any code change this test passed, confirming the constraint was live. Because we are relaxing that constraint, this passing test here is itself an erroneous behaviour.

`npm test -- --grep "Should bind Mina account to first depositor and reject others"` run in `contracts/ethereum` against the unmodified contract:

Results:

- 1 passing. The test passes against the unmodified contract, confirming the binding is live and that this behaviour is erroneous under the relaxed constraint.
- We also noticed a typo in `Should set NORI_BRIDE_ZKAPP_ACCT_TOKEN_ID from constructor` and corrected that.

We renamed and refactored the test `Should bind Mina account to first depositor and reject others` to assert the opposite `Should allow different depositors to lock to the same codeChallenge and accumulate correctly`. Updating the assertion from a failure should occur and the contract should revert - to the contract should permit the action of multiple ETH depositors sharing the same `codeChallenge`.

The full test suite was run to ensure no other regressions:

`npm run test`

Result:

`Should allow different depositors to lock to the same codeChallenge and accumulate correctly` fails with `SolidityError: VM Exception while processing transaction: reverted with an unrecognized custom error (return data: 0x30506bb1)` demonstrating the contracts undesirable rejection of the action - prior to relaxing the constraint.

## 02/6/26 - Finding 41428: In-flight mints are invalidated by the next `update()`

### Finding (verbatim)

Thanks for the detailed answers to my questions at the end of last week regarding update and mint and the timings on Mina versus SP1 etc., that was very helpful.

I dug in more into the concurrency questions regarding update and mint, and what kind of timeline users have for their mints.

There are two different timeframes to consider:
Deposit root availability: How long after the first update that placed a deposit root containing the deposit on-chain is that deposit root still available, so that the user can use it to mint?
Mint proof usability: If a user starts generating a mint proof at time X, and it gets included on-chain at time Y (or attempted to be included), will it be accepted or rejected?

With an update roughly every 16 minutes, and 32 deposit roots usable on-chain, that gives between 8 and 9 hours for deposit root availability.

This does not mean that a user that generated a mint proof immediately after the update appeared on chain that carries the deposit root containing their deposit can wait for up to 8 hours to submit it.

The noriMint method has a precondition that pins an action state to a value. So for this part:

```typescript
const windowStart = this.windowStart.getAndRequireEquals();
const actions = this.reducer.getActions({ fromActionState: windowStart });

const depositInWindow: Bool = this.reducer.reduce(
    actions,
    Bool,
    (found: Bool, action: Field) =>
        found.or(action.equals(contractDepositSlotRoot)),
    Bool(false),
    { maxUpdatesWithActions: maxWindow }
);
```

the prover must choose the action state hash that is the end of the window for the actions used. Now that precondition is special in that on-chain, there are 5 values available, and it just needs to match one of them. In the end that means if the user creates a mint proof, if afterwards there will be 5 `update`s happening before their mint is included, then it will be rejected.

In practice, if mints take ~2 minutes to prove for the user and `update` frequency is about every ~16 minutes, there should be enough time to submit the mint after having it proven, if the action state were the only state intersection between update and noriMint.

However, there is also another interaction.

As soon as the window is full (so after the first 32 updates at the very start after deployment of the contract), `update` will always change windowStart:

```typescript
this.windowStart.set(Provable.if(isFull, advancedStart, windowStart));
```

But windowStart is also read in noriMint and so in a precondition is pinned to a value by a mint proof:

```typescript
const windowStart = this.windowStart.getAndRequireEquals();
```

This means that if the user creates a mint proof, using the most up to date value of windowStart as of the time when they start the proof, then that proof will only be accepted on-chain if there was no update in-between.

In practice, if the update have a frequency of once every 16 minutes and it takes say 2 minutes from fetching on-chain data to inclusion of the mint transaction on-chain, then 2/16 = 12.5% of the time, a user's mint transaction will be rejected on-chain, and they need to try again.

This isn't a security problem in itself because the user can just try again, but your earlier answer contained "if there is a update tx pending in mempool, user's transaction would get included as there aren't any race conditions on state, as update and mint do not modify same state", which sounded like this behavior not being expected, and so as an unexpected 10% or more rejection rate on user attempts might be quite noticable in the overall user experience.

### Response

The finding is correct. `noriMint` reads `windowStart` via `getAndRequireEquals()`, which pins `windowStart == W` as a precondition on the mint transaction at prove time. Once the window is full every `update` advances `windowStart`, so an `update` landing between proving and inclusion makes the mint's precondition stale and the network rejects it (~12.5% at the cited cadence). The `actionState` end of the reducer read tolerates the last 5 action states, but `windowStart` is an ordinary state field with no tolerance, so a single update is enough.

### Commit 1 - Test exposure of in-flight mint invalidation

- **Regression test** (`contracts/mina/src/tests/41428.inflightMint.lightnet.integration.spec.ts`): added a self-contained lightnet test that fills the deposit-root window to `maxWindow` (honest evictions via the test-only `adminSetDepositRoot`), seeds the user's deposit as the newest window member, then builds **and proves** a mint. One further dispatch (an `update`) slides `windowStart` (with a sanity assert that it moved), after which the already-proven mint is sent; the test asserts it is still accepted and credits the balance. No mempool race is needed — the rejection is a stale precondition, reproduced sequentially (prove → update → send). It runs against lightnet because a real Mina node models the 5-element `actionState` precondition window the fix relies on; LocalBlockchain does not (a probe showed it rejects even a single intervening dispatch), so it cannot demonstrate the green side. The test-only `adminSetDepositRoot` method it relies on is enabled in the same commit.

Results:

- Regression test: fails on the current contract. The intervening `update` moves `windowStart`, and sending the proven mint is rejected on the now-stale `windowStart` precondition (`Account_app_state_precondition_unsatisfied`) — confirming the finding.

### Commit 2 - Fix applied

- **`noriMint` witnesses the window start** (`contracts/mina/src/NoriTokenBridge.ts`): instead of reading `windowStart` via `getAndRequireEquals()` (a zero-tolerance precondition), the method takes `windowStartWitness: Field` and uses it as the `getActions` start. The witness is fully constrained without that precondition — `reduce` asserts the chain `windowStartWitness -> ... -> account.actionState` matches the folded actions (a stale/off-chain witness cannot pass), and `maxUpdatesWithActions: maxWindow` bounds it from below. The only shared precondition left with `update` is `account.actionState`, which tolerates the last ~5 action states, so an `update` between proving and inclusion no longer invalidates the mint.
- **Call sites updated** to fetch and pass the witness: `workers/tokenBridgeTester/worker.ts`, `workers/tokenBridgeWorker/worker.ts` (three mint paths), and the integration specs (`full.local`, `main-thread/full.lightnet`, `main-thread/happyPath.lightnet`).
- **Regression test updated** to the witnessed (3-arg) call so it now exercises the fix.
- **Bridge verification key regenerated** (`integrity/NoriTokenBridge.VkData.json`, `NoriTokenBridge.VkHash.json`): the `noriMint` circuit changed.

Results:

- Regression test: passes on lightnet. After the intervening `update` slides `windowStart`, the already-proven mint is accepted (distance 1, within the 5-slot `actionState` tolerance) and credits the balance.
- Tolerance confirmed on lightnet by a probe: a pinned `actionState` survives up to 4 intervening updates (accepted at distances 1 and 4, rejected at 5+); LocalBlockchain rejects even distance 1 — the reason the green side runs on lightnet.
- The worker-driven `full.lightnet` and `happyPath.lightnet` suites pass with the fix.

### Commit 3 - Restore test-only method for production

- **`adminSetDepositRoot` re-commented** (`contracts/mina/src/NoriTokenBridge.ts`): the test-only seeding method enabled in commit 1 is disabled again so it is not part of the production contract. Its call sites in `full.lightnet` / `happyPath.lightnet` are re-commented and those `noriMint()` blocks re-`describe.skip`-ed; the `41428.inflightMint.lightnet` regression suite is `describe.skip`-ed (it depends on `adminSetDepositRoot`).  
  **Bridge verification key regenerated** (`integrity/NoriTokenBridge.VkData.json`, `NoriTokenBridge.VkHash.json`): reflects the production contract without `adminSetDepositRoot`.  


Results:

- The regression suite is `describe.skip`-ed by default (depends on the test-only `adminSetDepositRoot`); re-enable per the in-file note and run against lightnet to reproduce.

## 15/5/26 - Audit 4279a: `dispatchAndEvict` does not verify `oldestAction`

### Finding (verbatim)

Hi team, I have a question regarding dispatchAndEvict from NoriTokenBridge.ts. The docstring says "When the window is full, the caller must provide the oldest action as a witness. The contract verifies the hash chain `advanceActionState(windowStart, singleActionInnerHash(oldestAction))` and advances windowStart by one step, keeping the window size constant." And in the implementation, we have

```typescript
// Compute the advanced windowStart by verifying the oldest action chains correctly.
// If isFull is false, this computation is ignored (oldestAction can be anything).
const innerHash = singleActionInnerHash(oldestAction);
const advancedStart = advanceActionState(windowStart, innerHash);

// Conditionally advance: if full, slide the window; otherwise keep start.
this.windowStart.set(Provable.if(isFull, advancedStart, windowStart));
// If full: evict 1 + add 1 = same size. If not full: size + 1.
this.windowSize.set(Provable.if(isFull, windowSize, windowSize.add(1)));
```

The comment says "compute the advanced windowStart by verifying the oldest action chains correctly", but the verification seems to be deferred to noriMint()? In dispatchAndEvict, it looks like the new advancedStart is simply computed using whatever oldestAction is provided, with no constraint tying that value to the actual oldest dispatched action. So if an adversary provides a bad oldestAction, I think windowStart would be updated to a bad hash that is computed from the bad oldestAction. This bad hash does not correspond to any actual action chain state, so later when noriMint() is called and attempts to rebuild the chain, it would not go through, thus disabling the mint flow.

What is preventing an adversary from mounting the attack I described above? I feel that I might be missing something here.

### Response

The finding is correct. `dispatchAndEvict` advances `windowStart` using the caller-supplied `oldestAction` without constraining it to the real oldest action in the window. When the window is full, a caller can pass any value, moving `windowStart` to an action-state hash that lies off the real action chain. Subsequent `noriMint` calls fetch actions `fromActionState: windowStart`, which then resolves to nothing, disabling minting. As with a2090, testing is bolstered first (commit 1) to expose the issue, then the fix applied (commit 2). The intended fix removes the `oldestAction` parameter and derives the oldest action in-circuit via the reducer, so `windowStart` can only ever advance to a real point on the chain.

### Commit 1 - Test exposure of eviction witness integrity

- **Regression test** (`contracts/mina/src/tests/unit/4279a.evictionWitness.reggression.spec.ts`): added a self-contained LocalBlockchain test (`proofsEnabled: false`) that deploys the bridge, fills the deposit-root window to `maxWindow` via the test-only `adminSetDepositRoot` (**enabled for testing the regression ONLY** - will be removed), then dispatches one more deposit root with a deliberately bogus `oldestAction`. It asserts the window still resolves from `windowStart` (holds `maxWindow` roots, including the new one) and that the user can still `noriMint`. The test-only `adminSetDepositRoot` method it relies on is enabled in the same commit.

Results:

- Regression test: fails on the current contract. The bogus `oldestAction` poisons `windowStart`; `fetchActions({ fromActionState: windowStart })` throws `getActions: fromActionState not found`, so the window reads 0 roots (expected 32) and the mint flow is unreachable — confirming the finding.

### Commit 2 - Fix applied

- **`dispatchAndEvict` derives the oldest action in-circuit** (`contracts/mina/src/NoriTokenBridge.ts`): the caller-supplied `oldestAction` parameter is removed. The oldest action is now found by running `reducer.reduce` over the current window (`getActions({ fromActionState: windowStart })`) and latching the first action. o1js's reducer asserts the chain `windowStart -> ... -> account.actionState` matches the actions it yields, so the captured oldest is provably the real one and `windowStart` can only ever advance to a real point on the action chain. The new root is dispatched after the reduce so it is not pulled into the eviction scope.
- **`oldestAction` parameter dropped from `update` and `adminSetDepositRoot`** (`contracts/mina/src/NoriTokenBridge.ts`) and the now-unused `getOldestActionForEviction` helper removed (`contracts/mina/src/NoriTokenBridge.utils.ts`). Call sites updated: `proofSubmitter.ts`, `workers/tokenBridgeWorker/worker.ts`, `workers/tokenBridgeTester/worker.ts`, and the integration specs.
- **Bridge verification key regenerated** (`contracts/mina/src/integrity/NoriTokenBridge.VkData.json`, `NoriTokenBridge.VkHash.json`): the `update` circuit changed.
- **Regression test updated to the single-argument API** (`contracts/mina/src/tests/unit/4279a.evictionWitness.reggression.spec.ts`): with no `oldestAction` to supply, the test now confirms a full-window eviction keeps the window healthy and mintable. **NOTE: this regression will pass by definition of the fix, as the oldestAction is no longer provided but deterministically derived in provable way **

Results:

- Regression test: passes. After filling the window to `maxWindow` and dispatching one further root, the window still resolves from `windowStart` (holds `maxWindow` roots, including the new one) and the user mints successfully. `windowStart` can no longer be poisoned by the caller.

### Commit 3 - Restore test-only method and regenerate integrity data

- **`adminSetDepositRoot` re-commented** (`contracts/mina/src/NoriTokenBridge.ts`): the test-only seeding method enabled in commit 1 is disabled again so it is not part of the production contract. Its callers in `NoriTokenBridge.full.local.integration.spec.ts` are re-commented, and the eviction-witness regression suite (`contracts/mina/src/tests/unit/4279a.evictionWitness.reggression.spec.ts`) is `describe.skip`-ed with a note documenting how to re-enable it.
- **Bridge verification key regenerated** (`contracts/mina/src/integrity/NoriTokenBridge.VkData.json`, `NoriTokenBridge.VkHash.json`): reflects the production contract without `adminSetDepositRoot`.

Results:

- Regression suite is `describe.skip`-ed by default (depends on the test-only `adminSetDepositRoot`); re-enable per the in-file note to run it.

## 15/5/26 - Audit A2090: Non-standard Merkle zero indexing

### Finding (verbatim)

Finding a2090: `buildMerkleTree` uses the `zeros` array backwards

Hi, we noticed an issue in nori-bridge-sdk\o1js-zk-utils\src\merkle-attestor\merkleTree.ts. When using zero hash while building the Merkle tree, the incorrect level/index is used.

In buildMerkleTree (and also foldMerkleLeft and getMerklePathFromLeaves), zeros is set to be getMerkleZeros(depth) by the caller, which generates an array of Hashes that correspond to all-zero subtrees.

```typescript
/**
 * Generate zero hashes array of length depth + 1
 */
export function getMerkleZeros(depth: number): Field[] {
    const zeros: Field[] = [];

    // Start with zeros[0] = Field(0)
    zeros.push(Field(0));

    for (let i = 1; i < depth + 1; i++) {
        // Each next zero is hash of the previous zero with itself
        zeros.push(Poseidon.hash([zeros[i - 1], zeros[i - 1]]));
    }

    return zeros;
}
```

Notice that the array is ordered from smallest subtree (tree with a single 0 node, depth 0) to largest (tree of depth depth, i.e. depth+1 levels).

However, in buildMerkleTree, when utilizing the zeros array, the following snippet is used:

```typescript
for (let level = depth; level > 0; level--) {
    // Omitted...

    for (let i = 0; i < parentWidth; i++) {
        const leftIdx = 2 * i;

        if (leftIdx >= nNonDummyNodes) {
            // Both left and right dummy nodes, use zeros cache
            parentLevel[i] = zeros[level];
        } else {
            // Omitted...
        }
    }
    // Omitted...
}
```

The zeros array is used backwards. e.g., when level=depth, the child level is the bottom layer of the tree, and the parent level is the layer above and hence should use zeros[1], hash that corresponds to a subtree of depth 1. Instead, the current code uses zeros[level], which is the hash for a subtree of depth depth.

This leads to a completeness issue. The Mina bridge's off-chain witness builder uses this helper to derive deposit proofs, and noriMint() later recomputes the root on-chain and requires it to match the verified Ethereum deposit root. Whenever the number of leaves in the tree is not a power of 2 (i.e., there are dummy nodes in the tree), due to this incorrect calculation of the Merkle root, valid deposits would become unmintable even though the Ethereum proof and deposit data are correct.

The fix is relatively straightforward: either reverse the order of the result of getMerkleZeros, or replace parentLevel[i] = zeros[level]; with parentLevel[i] = zeros[depth + 1 - level];.

### Response

The non-standard indexing is acknowledged. The same reversed indexing exists symmetrically in both the TypeScript (`merkleTree.ts`) and Rust (`merkle_poseidon_fixed.rs`) implementations across all three affected functions: `buildMerkleTree`/`build_merkle_tree`, `foldMerkleLeft`/`fold_merkle_left`, and `getMerklePathFromLeaves`/`get_merkle_path_from_leaves`. Because both producers in this closed system use the same non-standard convention, the computed roots agree across languages for all leaf counts. We do not believe there is a soundness or completeness failure in the deployed system. If the bug were asymmetric, failures would appear at any non-power-of-two count leaving adjacent dummies, the smallest being n=5, then 6, 9, 10, 11, 12, 13. Applying the proposed fix to only one side would introduce the completeness failure described in the report. The mistake cancels out leaving it safe as written but highly non-standard. Worth fixing but needs to be done carefully to avoid regression of the mint function.

### Discussion

After discussion it was noted that the two cited tests are not sufficient to rule out cross-language divergence when run in isolation, as each only checks self-consistency within its own language. This is agreed. The tests were not designed to be used in isolation. They were designed to be used in concert: the raw output from any two of the three test suites (Rust, TypeScript non-provable, TypeScript provable) was compared using an uncommitted comparison script that normalised and diffed leaves and roots line-by-line across languages. An improved version of this script (`o1js-zk-utils/test/cross-reference-roots.sh`) is now committed to nori-bridge-sdk for transparency.

Three test suites cover this code:

1. Rust - `cargo test -p nori-hash test_all_leaf_counts_and_indices_with_build_and_fold` (n_leaves 0-50)
2. TypeScript (non-provable) - `npm run test -- -t "test_all_leaf_counts_and_indices_with_build_and_fold"` (n_leaves 0-50)
3. TypeScript (provable) - `npm run test -- -t "test_all_leaf_counts_and_indices_with_pipeline"` (n_leaves 0-10, truncated for speed; previously run to 50)

This cross-referencing is a sample-based confidence check, not a claim of completeness proof.

The finding correctly identifies a deviation from the standard Merkle zero-hash convention. While harmless in the current closed two-implementation system, non-standard indexing would be a problem for any future third-party verifier or public auditability tooling that assumes the standard convention. The fix is accepted and will be applied to both sides simultaneously. Testing will be bolstered first (commit 1) to expose the non-standard indexing against independent reference implementations, then the fix applied (commit 2), so that the before and after results can be documented in this summary.

### Commit 1 - Test exposure of the non-standard indexing

- **Regression tests** (`o1js-zk-utils/src/merkle-attestor/merkleTree.spec.ts`): added `regression_a2090_bruteforce_reference_buildMerkleTree`, `regression_a2090_bruteforce_reference_foldMerkleLeft`, `regression_a2090_o1js_merkle_tree_reference_buildMerkleTree`, and `regression_a2090_o1js_merkle_tree_reference_foldMerkleLeft` as `test.each` over leaf counts [1, 3, 5, 6, 9, 17] verifying `buildMerkleTree` and `foldMerkleLeft` against two independent reference implementations. The brute-force reference pads with Field(0) and hashes every pair with no zeros cache. The o1js `MerkleTree` reference uses the standard o1js Merkle tree implementation. Neither references the zeros array. Leaf counts 5, 6, 9, 17 exercise the bug (adjacent dummy nodes at various depths); 1 and 3 are sanity cases where only a lone dummy pairs with a real leaf.
- **Cross-reference script** (`o1js-zk-utils/test/cross-reference-roots.sh`): committed for reproducible cross-language verification of leaves and roots across the Rust, TypeScript non-provable, and TypeScript provable test suites. See `o1js-zk-utils/test/CROSS-REFERENCE-ROOTS.md` for usage.

Results:

- Regression tests: nLeaves 1 and 3 pass (no adjacent dummies, 8 pass). nLeaves 5, 6, 9, 17 fail against both the brute-force and o1js `MerkleTree` references for both `buildMerkleTree` and `foldMerkleLeft` (8 failures per reference, 16 fail, 24 total checks), confirming the non-standard indexing is detectable and diverges from the standard convention.
- Self-consistency (Rust): passes 0-50 leaves.
- Self-consistency (TypeScript non-provable): passes 0-50 leaves.
- Self-consistency (TypeScript provable): passes 0-10 leaves.
- Cross-reference (unpatched Rust vs unpatched TypeScript non-provable): 51 leaf counts, all leaves and roots match. Zero differences.
- Cross-reference (unpatched Rust vs unpatched TypeScript provable): 11 leaf counts (0-10), all leaves and roots match. Zero differences.

### Commit 2 - Fix applied

- **`zeros[level]` corrected to `zeros[depth + 1 - level]`** (`o1js-zk-utils/src/merkle-attestor/merkleTree.ts`): three sites patched in `buildMerkleTree` (line 86), `foldMerkleLeft` (line 144), and `getMerklePathFromLeaves` (line 219). When the tree-building loop is at a given `level` counting down from `depth`, the parent node of two dummy children represents an all-zero subtree of height `depth + 1 - level`. The corrected index selects the matching precomputed zero hash from `getMerkleZeros`.

Results:

- Regression tests: 24 pass, 0 fail. All leaf counts [1, 3, 5, 6, 9, 17] now match both the brute-force and o1js `MerkleTree` references for both `buildMerkleTree` and `foldMerkleLeft`.
- Self-consistency (Rust): passes 0-50 leaves.
- Self-consistency (TypeScript non-provable): passes 0-50 leaves.
- Self-consistency (TypeScript provable): passes 0-10 leaves.
- Cross-reference (patched Rust vs patched TypeScript non-provable): 51 leaf counts, 0 leaf mismatches, 0 root mismatches.
- Cross-reference (patched Rust vs patched TypeScript provable): 51 leaf counts checked, 0 root mismatches, 40 leaf mismatches (all MISSING, provable suite only runs 0-10, no data exists for 11-50), 11 overlapping leaf counts all leaves and roots match.
- Cross-reference (patched TypeScript non-provable vs patched TypeScript provable): 51 leaf counts checked, 0 root mismatches, 40 leaf mismatches (all MISSING, provable suite only runs 0-10, no data exists for 11-50), 11 overlapping leaf counts all leaves and roots match.

## 28/4/26

### Migrated to @nori-zk/mina-attestations Fork

- **@nori-zk/mina-attestations@0.6.4**: replaced upstream `mina-attestations` with Nori's scoped fork
    - o1js upgraded to 3.0.0-mesa.698ca
    - package renamed to @nori-zk/mina-attestations and deployed into Nori's org scope
    - file restrictions added to package.json to minimise npm package size
    - tree-shakeable `./dynamic/array` subpath export added
    - side-effect fix for `BaseType.GenericRecord` registration on the `./dynamic/array` subpath
    - npm audit fix applied
    - DynamicArray imports updated to use the new subpath

### @nori-zk/proof-conversion Bumped

- **@nori-zk/proof-conversion** bumped from 0.8.19 to 0.8.20 -- o1js peer dep updated from 2.12.0 to 3.0.0-mesa.698ca

### Stale Dependencies Removed

- **autrace removed**: not imported anywhere in the codebase, and its `o1js: ^2.3.0` dependency made the resolved o1js version ambiguous. With autrace gone and the mina-attestations fork targeting 3.0.0-mesa.698ca directly, o1js overrides removed across all workspaces
- **xstate removed**: stale dependency from previously removed code, tsconfig path entry cleaned up

### npm audit

- 16 vulnerabilities reported (9 low, 4 moderate, 3 high) -- all transitive through Hardhat tooling (elliptic, lodash-es, serialize-javascript) and mocha (diff, serialize-javascript). None are runtime dependencies and none end up in build output. `npm audit fix` resolves nothing without breaking changes to @nomicfoundation/hardhat-ignition. Remaining issues are upstream and do not affect deployed contracts or ZK circuits

## 27/4/26

### Ethereum Constructor Hardening and TimelockController

- **`TimelockController.sol`** (`contracts/ethereum/contracts/TImeLockController.sol`): OpenZeppelin v5.6 TimelockController added for future governance timelocking of admin operations
- **Ethereum `NoriTokenBridge` constructor** (`contracts/ethereum/contracts/NoriTokenBridge.sol`): now accepts `_zkappAcctTokenId`, `_zkappAcctVerificationKeyHash`, and `_feeRecipient`. Previously hard-coded TODO placeholders replaced with `immutable` fields set at deployment
- **Deploy task** (`contracts/ethereum/tasks/deploy.ts`): updated to pass new constructor args
- **Hardhat tests** (`contracts/ethereum/test/NoriTokenBridge.ts`): updated all `deploy()` calls, added tests for immutable tokenId, vkHash, and feeRecipient constructor behaviour
- **Stale TODOs removed** from `setAlignedContracts`, `deposit`, and `setBridgeOperator`

### deriveTokenId CLI Script

- **`deriveTokenId` CLI script** (`contracts/mina/src/bin/deriveTokenId.ts`): derives the Mina tokenId for a given public key via `TokenId.derive`, useful for pre-deploy parameter computation
- **Unit tests** (`contracts/mina/src/tests/unit/deriveTokenId.unit.spec.ts`)

### Deployment Document WIP

- **`contracts/DEPLOYMENT.md`** added with deployment procedure documentation (work in progress)

### Immutable zkApp Constants Reordered

- **`NoriTokenBridge.sol`**: `NORI_STORAGE_ZKAPP_ACCT_VERIFICATION_KEY_HASH` and `NORI_BRIDE_ZKAPP_ACCT_TOKEN_ID` moved below custom errors and state variables for Solidity storage layout clarity

### Genesis Root On-Chain State and Deploy Wiring

- **`@state(Field) genesisRoot` on `NoriTokenBridge`** (`contracts/mina/src/NoriTokenBridge.ts`): Poseidon-hashed immutable on-chain anchor set at deploy. `update()` asserts the proof genesis validators root matches, rejecting proofs from a different Ethereum chain. No admin setter exists by design
- **`extractGenesisRootFromSP1Proof` helper** (`o1js-zk-utils/src/utils.ts`): decodes the genesis root from an SP1 proof and returns its Poseidon hash
- **`NORI_ETH_GENESIS_ROOT`** added to staging config (`contracts/mina/src/env.ts`) and `Env` type
- **`genesisRoot` wired through deploy pipeline**: deploy CLI accepts it as 4th positional arg, `NoriTokenControllerDeployProps` extended, `proofSubmitter`, `tokenBridgeTester` worker, and all integration/e2e test deploy calls updated
- **`ethVerify` return type** now returns both `ethGenesisRootBytes` and `ethTokenBridgeAddressBytes`
- **`NoriTokenBridge.VkData.json` and `NoriTokenBridge.VkHash.json`** updated after genesis root state addition
- **`pre-deploy.ts` removed** (renamed `preDeploy.ts` in previous entry); `package.json` script path fixed
- **Ethereum README** updated with `ETH_CONSENSUS_RPC` and genesis root documentation for pre-deploy

### Test Example Proofs on o1js 3.0.0-mesa.698

- **Test example proof series replaced**: 10102688--10102912 replaced with 10131744--10131840 with new proofs, p0 data, sp1Proof data, nodeVk, and index/type files generated under o1js `3.0.0-mesa.698`
- **`sp1-mpt-proof` test data replaced**: `10102688-v6.1.0.json` replaced with `10131744-v6.1.0.json` in both `contracts/mina` and `o1js-zk-utils`
- **Primary proof data** (`proofs/p0.json`, `proofs/sp1Proof.json`): refreshed for mesa.698

### Ethereum Artifact Rebuild

- **Ethereum contract artifacts rebuilt** (`MinaAccountValidation.json`, `MinaStateSettlement.json`, `NoriTokenBridge.json`, `TimelockController.json`, `NoriTokenBridge__factory.ts`): regenerated after constructor and immutable-field changes

### VkData Updated

- **`NoriTokenBridge.VkData.json` and `NoriTokenBridge.VkHash.json`** updated to match current verification keys after genesis root state addition and mesa.698 recompilation

## 24/4/26

### Mina NoriTokenBridge Permissions Hardened

- **`NoriTokenBridge` permissions** (`contracts/mina/src/NoriTokenBridge.ts`): `access` permission set to `Permissions.proof()`, `canChangeAdmin` now returns `Bool(false)`
- **Import consolidation**: `VerificationKey` and `AccountUpdateForest` moved into main `o1js` import, duplicate import blocks for `depositAttestation.js` merged
- **`updateVerificationKey` docstring** expanded to note it is required if proof-conversion vk changes or `EthInput` type changes
- **`updateStoreHash` comment** added noting it is needed in case Helios changes its store structure
- **`adminSetDepositRoot` docstring** marked with `@TODO` for future removal

### Genesis Root in Public Outputs

### Changed

- **Proof public output layout extended**: added `genesisRoot` (Bytes32) at offset 196, total proof length increased from 196 to 228 bytes -- every state transition is now cryptographically bound to the Ethereum chain it was generated against
- **`EthInput` struct** (`o1js-zk-utils/src/ethVerifier.ts`): added `genesisRoot: Bytes32.provable` field and appended it to the byte-commitment concatenation
- **`NoriTokenBridge`** (`contracts/mina/src/NoriTokenBridge.ts`): appended `input.genesisRoot.bytes` to the commitment hash check
- **`decodeConsensusMptProof`** (`o1js-zk-utils/src/utils.ts`): updated `proofOffsets` and slicing logic to extract `genesisRoot` from proof data
- **`pre-deploy.ts` renamed to `preDeploy.ts`** (`contracts/ethereum/bin`): renamed for consistency, refactored error handling from `process.exit` to thrown errors wrapped in a top-level catch, and added `fetchGenesisValidatorsRoot` which queries the beacon chain consensus API and writes `NORI_ETH_GENESIS_ROOT` to `.env.nori-eth-pre-deploy`
- **`slot_nested_key_attestation_hash` renamed to `slot_key_code_challenge`** across test data and specs to match updated contract storage slot schema
- **`@nori-zk/pts-types` upgraded from `5.0.0` to `6.0.1`** across all workspaces (`contracts/mina`, `o1js-zk-utils`, `minimal-client`)
- **Test example series replaced**: 10080800--10080896 to 10102688--10102912 with proofs generated under the new ZK program that includes genesis root in its public outputs
- **`sp1ProofMessage.ts`** simplified in both `contracts/mina` and `o1js-zk-utils` -- removed inline type definition in favour of spread + cast from JSON import
- **Integrity hashes and pi0 updated** (`NoriTokenBridge.VkHash.json`, `NoriTokenBridge.VkData.json`, `EthVerifier.VkHash.json`, `nori-sp1-helios-program.pi0.json`) to match the updated ZK program with genesis root in public outputs
