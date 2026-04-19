# Test Naming Conventions

## Pattern Structure

```
<fileName>.<number>?.<testType>.spec.ts
```

- `<fileName>`: Component/feature name (PascalCase or kebab-case)
- `<number>`: Optional split number when test file gets too large for runtime
- `<testType>`: `unit`, `integration`, or `e2e`

## Test Type Hierarchy

### Unit Tests

**Scope**: Single file/component isolation  
**Pattern**: `<ComponentName>.<number>?.unit.spec.ts`

```
keygen.unit.spec.ts
sigToHash.unit.spec.ts
NoriTokenBridge.update.1.unit.spec.ts   # split example
NoriTokenBridge.update.2.unit.spec.ts
```

- Split with `.1`, `.2`, `.3` when too many tests break runtime
- Tests specific component methods/functions

### Integration Tests

**Scope**: Multiple components/zk programs working together  
**Pattern**: `<feature>.integration.spec.ts`

```
deposit-prerequisites.integration.spec.ts
aligned.integration.spec.ts
```

- Tests component interactions and ZK program coordination
- Example: `deposit-prerequisites` tests various ZK programs for deposit attestation verification

### E2E Tests

**Scope**: Full system workflows across network environments  
**Pattern**: `<feature>.<environment>?.e2e.spec.ts`

#### Environment-Specific

```
nori-only.devnet.e2e.spec.ts
nori-only.lightnet.e2e.spec.ts
```

- Environment suffix when testing specific networks
- `nori-only` = one-way bridge (ETH→Mina)

#### Feature-Specific

```
aligned.e2e.spec.ts
```

- No environment suffix if not applicable, these represent two way bridging tests.

## Folder Structure

Tests live under `src/tests/` in each workspace:

```
src/tests/
├── testUtils.ts          # shared helpers (also re-exported via workspace API where applicable)
├── <name>.integration.spec.ts      # worker-based integration specs (default)
├── unit/                 # *.unit.spec.ts
├── e2e/                  # *.e2e.spec.ts
└── main-thread/        # main-thread variants of integration specs (see below)
```

- **`unit/`** — fast, isolated tests (`*.unit.spec.ts`).
- **`e2e/`** — full-system workflow tests (`*.e2e.spec.ts`), usually with an environment suffix (`devnet`, `lightnet`).
- **Top level of `tests/`** — worker-based integration specs. This is the **preferred, reliable** execution model. Workers (`getTokenBridgeWorker` / `getTokenBridgeTester`) compile and run zk circuits in a dedicated Node worker process that is terminated and recreated between phases, which contains o1js-related memory growth that otherwise accumulates across proof computations.
- **`main-thread/`** — main-thread variants of the same integration specs. These compile zk circuits directly in the Jest process with no worker indirection. Useful for debugging and profiling, but **not reliable across all machines**: o1js memory leaks accumulate within a single process, and on constrained hosts these runs OOM or hang after a few proof computations. Prefer the worker-based variant; reach for these only when you need a straight-line stack trace or a worker-less environment.

The `test:*` scripts recurse into `src/` via `find`, so subfolder depth does not affect discovery.

## Package.json Structure

### Workspace package.json

```json
{
    "name": "@nori/workspace-name",
    "scripts": {
        "test": "npm run build && node --experimental-vm-modules --experimental-wasm-modules --max-old-space-size=8192 ../../node_modules/jest/bin/jest.js --forceExit --",
        "test:unit": "for file in $(find . -name '*.unit.spec.ts'); do npm run test -- \"$file\" || exit 1; done",
        "test:integration": "for file in $(find . -name '*.integration.spec.ts'); do npm run test -- \"$file\" || exit 1; done",
        "test:e2e": "for file in $(find . -name '*.e2e.spec.ts'); do npm run test -- \"$file\" || exit 1; done"
    }
}
```

**Runtime Isolation**: Each test file runs in its own isolated Node.js process via the bash loop. This prevents memory leaks from accumulating across test suites and ensures clean state between files. Critical for ZK computation tests that consume significant memory (8GB+ heap). The `|| exit 1` ensures fast failure on the first test error.

### Root package.json

Aggregates across workspaces via `--workspaces --if-present`:

```json
{
    "name": "@nori-zk/nori-bridge-sdk",
    "scripts": {
        "test": "npm run test --workspaces --if-present",
        "test-ci": "npm run test-ci --workspaces --if-present"
    }
}
```

Per-type aggregators (`test:unit` / `test:integration` / `test:e2e`) are not defined at the root — run those per-workspace.

## Test Execution

### Workspace-level

```bash
npm run test:unit        # Runs all *.unit.spec.ts (each file in separate runtime)
npm run test:integration # Runs all *.integration.spec.ts (each file in separate runtime)
npm run test:e2e         # Runs all *.e2e.spec.ts (each file in separate runtime)

# Run a specific test file
npm run test -- NoriTokenBridge.full.lightnet.integration.spec.ts
npm run test -- nori-only.lightnet.e2e.spec.ts

# Filter by test name (any workspace script that forwards args to jest)
npm run test -- -t "should perform a series of proof submissions"
```

### Root-level (all workspaces)

```bash
npm run test             # Runs each workspace's `test` script
npm run test-ci          # Runs each workspace's `test-ci` script (CI subset)
```

Workspace context is implicit from folder location.
