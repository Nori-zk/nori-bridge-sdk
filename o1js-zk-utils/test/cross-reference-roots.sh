#!/usr/bin/env bash
# Cross-reference two Merkle test output files (leaves + roots).
# Accepts raw output from any of the three test suites:
#   - Rust:        cargo test -p nori-hash test_all_leaf_counts_and_indices_with_build_and_fold -- --nocapture
#   - TS:          npm run test -- -t "test_all_leaf_counts_and_indices_with_build_and_fold"
#   - TS provable: npm run test -- -t "test_all_leaf_counts_and_indices_with_pipeline"
#
# Usage: bash cross-reference-roots.sh <output_a> <output_b>

set -euo pipefail

if [ $# -ne 2 ]; then
    echo "Usage: $0 <output_a> <output_b>"
    exit 1
fi

FILE_A="$1"
FILE_B="$2"

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

# Normalise leaves lines across Rust/TS formats into: comma-separated values, no spaces, no trailing comma
extract_leaves() {
    grep -E "^\s*leaves" "$1" \
        | sed 's/.*leaves[= ]*//' \
        | sed 's/\s*,\s*/,/g' \
        | sed 's/,$//' \
        | sed 's/^\s*//;s/\s*$//'
}

# Normalise root lines across Rust (root_via_fold) and TS (rootViaFold)
extract_roots() {
    grep -E "root_via_fold|rootViaFold" "$1" \
        | sed 's/.*root_via_fold = //;s/.*rootViaFold = //' \
        | sed 's/^\s*//;s/\s*$//'
}

extract_leaves "$FILE_A" > "$TMPDIR/a_leaves.txt"
extract_leaves "$FILE_B" > "$TMPDIR/b_leaves.txt"
extract_roots "$FILE_A" > "$TMPDIR/a_roots.txt"
extract_roots "$FILE_B" > "$TMPDIR/b_roots.txt"

LEAF_MISMATCHES=0
ROOT_MISMATCHES=0
LINE=0

while IFS=$'\t' read -r leaf_a leaf_b; do
    read -r root_a root_b <&3 || true
    if [ -z "$leaf_a" ] && [ -z "$leaf_b" ]; then
        printf "nLeaves=%3d  WARNING: no leaf data from either side\n" "$LINE"
    elif [ -z "$leaf_a" ] || [ -z "$leaf_b" ]; then
        printf "nLeaves=%3d  MISSING\n" "$LINE"
        [ -z "$leaf_a" ] && printf "  A: (no data)\n" || printf "  A: %s\n" "$leaf_a"
        [ -z "$leaf_b" ] && printf "  B: (no data)\n" || printf "  B: %s\n" "$leaf_b"
        LEAF_MISMATCHES=$((LEAF_MISMATCHES + 1))
    elif [ "$leaf_a" != "$leaf_b" ]; then
        printf "nLeaves=%3d  LEAF MISMATCH\n" "$LINE"
        printf "  A: %s\n" "$leaf_a"
        printf "  B: %s\n" "$leaf_b"
        LEAF_MISMATCHES=$((LEAF_MISMATCHES + 1))
    elif [ -z "$root_a" ] && [ -z "$root_b" ]; then
        printf "nLeaves=%3d  WARNING: no root data from either side\n" "$LINE"
    elif [ -z "$root_a" ] || [ -z "$root_b" ]; then
        printf "nLeaves=%3d  MISSING ROOT\n" "$LINE"
        [ -z "$root_a" ] && printf "  A: (no data)\n" || printf "  A: %s\n" "$root_a"
        [ -z "$root_b" ] && printf "  B: (no data)\n" || printf "  B: %s\n" "$root_b"
        ROOT_MISMATCHES=$((ROOT_MISMATCHES + 1))
    elif [ "$root_a" != "$root_b" ]; then
        printf "nLeaves=%3d  ROOT MISMATCH (leaves match)\n" "$LINE"
        printf "  A: %s\n" "$root_a"
        printf "  B: %s\n" "$root_b"
        ROOT_MISMATCHES=$((ROOT_MISMATCHES + 1))
    else
        printf "nLeaves=%3d  MATCH\n" "$LINE"
    fi
    LINE=$((LINE + 1))
done < <(paste "$TMPDIR/a_leaves.txt" "$TMPDIR/b_leaves.txt") \
     3< <(paste "$TMPDIR/a_roots.txt" "$TMPDIR/b_roots.txt")

echo ""
echo "Checked $LINE leaf counts."
echo "Leaf mismatches: $LEAF_MISMATCHES"
echo "Root mismatches: $ROOT_MISMATCHES"
if [ "$LEAF_MISMATCHES" -eq 0 ] && [ "$ROOT_MISMATCHES" -eq 0 ]; then
    echo "RESULT: All leaves and roots match."
else
    echo "RESULT: Mismatches found."
fi
