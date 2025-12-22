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
NoriTokenController.aligned.1.unit.spec.ts
NoriTokenController.aligned.2.unit.spec.ts
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
nori-only.litenet.e2e.spec.ts
```

- Environment suffix when testing specific networks
- `nori-only` = one-way bridge (ETH→Mina)

#### Feature-Specific
```
aligned.e2e.spec.ts
```

- No environment suffix if not applicable, these represent two way bridging tests.

## Package.json Structure

### Workspace package.json
```json
{
  "name": "@nori/workspace-name",
  "scripts": {
    "test": "npm run build && node --experimental-vm-modules --experimental-wasm-modules --max-old-space-size=8192 ../../../node_modules/jest/bin/jest.js --forceExit --",
    "test:unit": "for file in $(find . -name '*.unit.spec.ts'); do npm run test -- \"$file\" || exit 1; done",
    "test:integration": "for file in $(find . -name '*.integration.spec.ts'); do npm run test -- \"$file\" || exit 1; done",
    "test:e2e": "for file in $(find . -name '*.e2e.spec.ts'); do npm run test -- \"$file\" || exit 1; done"
  }
}
```

**Runtime Isolation**: Each test file runs in its own isolated Node.js process via the bash loop. This prevents memory leaks from accumulating across test suites and ensures clean state between files. Critical for ZK computation tests that consume significant memory (8GB+ heap). The `|| exit 1` ensures fast failure on the first test error.

### Root package.json
```json
{
  "name": "@nori/monorepo",
  "scripts": {
    "test:unit": "npm run test:unit --workspaces --if-present",
    "test:integration": "npm run test:integration --workspaces --if-present",
    "test:e2e": "npm run test:e2e --workspaces --if-present",
    "test:all": "npm run test:unit && npm run test:integration && npm run test:e2e"
  }
}
```

## Test Execution

### Workspace-level
```bash
npm run test:unit        # Runs all *.unit.spec.ts (each file in separate runtime)
npm run test:integration # Runs all *.integration.spec.ts (each file in separate runtime)
npm run test:e2e         # Runs all *.e2e.spec.ts (each file in separate runtime)

# Run a specific test file
npm run test -- NoriTokenController.aligned.1.unit.spec.ts
npm run test -- aligned.e2e.spec.ts
```

### Root-level (all workspaces)
```bash
npm run test:unit        # Runs unit tests in all workspaces
npm run test:integration # Runs integration tests in all workspaces
npm run test:e2e         # Runs e2e tests in all workspaces
npm run test:all         # Runs everything
```

Workspace context is implicit from folder location.