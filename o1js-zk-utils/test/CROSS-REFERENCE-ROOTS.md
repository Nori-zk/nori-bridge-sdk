# Cross-Reference Roots

Compares Merkle leaves and roots across any two of the three test suites to verify cross-language agreement.

## Test suites

1. **Rust** - `cargo test -p nori-hash test_all_leaf_counts_and_indices_with_build_and_fold -- --nocapture` (nLeaves 0-50)
2. **TypeScript (non-provable)** - `npm run test -- -t "test_all_leaf_counts_and_indices_with_build_and_fold"` (nLeaves 0-50)
3. **TypeScript (provable)** - `npm run test -- -t "test_all_leaf_counts_and_indices_with_pipeline"` (nLeaves 0-10, previously run to 50, dialed back for test runtime)

## Usage

### 1. Capture test output

```bash
# Rust (from nori-bridge-head)
cargo test -p nori-hash test_all_leaf_counts_and_indices_with_build_and_fold -- --nocapture 2>&1 > /tmp/rust_output.txt

# TypeScript non-provable (from nori-bridge-sdk/o1js-zk-utils)
npm run test -- -t "test_all_leaf_counts_and_indices_with_build_and_fold" 2>&1 > /tmp/ts_output.txt

# TypeScript provable (from nori-bridge-sdk/o1js-zk-utils)
npm run test -- -t "test_all_leaf_counts_and_indices_with_pipeline" 2>&1 > /tmp/ts_provable_output.txt
```

### 2. Run the cross-reference script

```bash
bash cross-reference-roots.sh /tmp/rust_output.txt /tmp/ts_output.txt
bash cross-reference-roots.sh /tmp/rust_output.txt /tmp/ts_provable_output.txt
bash cross-reference-roots.sh /tmp/ts_output.txt /tmp/ts_provable_output.txt
```

## Output

The script normalises the output formats (Rust uses `leaves=` and `root_via_fold =`, TypeScript uses `leaves ` and `rootViaFold =`) and compares line-by-line.

- `MATCH` - leaves and root agree for that leaf count
- `LEAF MISMATCH` - leaf hashes differ (indicates a hashing divergence)
- `ROOT MISMATCH (leaves match)` - leaves agree but root differs (indicates a tree-building divergence, e.g. zeros indexing)
- `MISSING` - one side has data and the other does not (expected when comparing suites with different ranges)
- `WARNING: no leaf data from either side` - neither side produced leaf data for that count (e.g. nLeaves=0)
- `WARNING: no root data from either side` - neither side produced root data for that count

## Scope and limitations

This is a sample-based confidence check. The Rust and TypeScript non-provable suites cover nLeaves 0-50. The TypeScript provable suite covers nLeaves 0-10 (previously run to 50, truncated for test runtime). It verifies that the implementations produce identical leaf hashes and identical Merkle roots for all tested leaf counts. It does not constitute a completeness proof.
