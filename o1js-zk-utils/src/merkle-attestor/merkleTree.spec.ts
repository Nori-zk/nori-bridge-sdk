import { Field, MerkleTree, Poseidon } from 'o1js';
import {
    computeMerkleTreeDepthAndSize,
    getMerkleZeros,
    buildMerkleTree,
    foldMerkleLeft,
    getMerklePathFromTree,
    computeMerkleRootFromPath,
    getMerklePathFromLeaves,
} from './merkleTree.js';
import { type Bytes32 } from '../types.js';
import {
    buildLeavesNonProvable,
    dummyCodeChallenge,
    dummyValue,
    nonProvableStorageSlotLeafHash,
} from './testUtils.js';

// Full Merkle lifecycle test using actual hashed leaves and leaf index
function fullMerkleTest(
    pairs: Array<[Bytes32, Bytes32]>,
    leafIndex: number
): Field {
    const leaves = buildLeavesNonProvable(pairs);
    const { depth, paddedSize } = computeMerkleTreeDepthAndSize(leaves.length);
    const zeros = getMerkleZeros(depth);

    const leavesClone = leaves.slice();
    const root = foldMerkleLeft(leavesClone, paddedSize, depth, zeros);

    const leavesForPath = leaves.slice();
    const path = getMerklePathFromLeaves(
        leavesForPath,
        paddedSize,
        depth,
        leafIndex,
        zeros
    );

    const leafHash = leaves[leafIndex] ?? Field(0);
    const recomputedRoot = computeMerkleRootFromPath(leafHash, leafIndex, path);

    expect(recomputedRoot.equals(root).toBoolean()).toBe(true);

    return recomputedRoot;
}

// Brute-force reference: pad with Field(0), hash every pair, no zeros cache.
function referenceRoot(leaves: Field[], paddedSize: number): Field {
    let level = [...leaves];
    while (level.length < paddedSize) level.push(Field(0));
    while (level.length > 1) {
        const next: Field[] = [];
        for (let i = 0; i < level.length; i += 2) {
            next.push(Poseidon.hash([level[i], level[i + 1]]));
        }
        level = next;
    }
    return level[0];
}

describe('regression_a2090_zeros_indexing', () => {
    // 1,3  -- no dummy pairs (sanity)
    // 5,6  -- dummy pairs at depth 3
    // 9    -- dummy pairs at depth 4
    // 17   -- dummy pairs at depth 5
    test.each([1, 3, 5, 6, 9, 17])(
        'regression_a2090_bruteforce_reference_buildMerkleTree nLeaves=%i',
        (nLeaves) => {
            const pairs: Array<[Bytes32, Bytes32]> = [];
            for (let i = 0; i < nLeaves; i++) {
                pairs.push([dummyCodeChallenge(i), dummyValue(i)]);
            }
            const leaves = buildLeavesNonProvable(pairs);
            const { depth, paddedSize } =
                computeMerkleTreeDepthAndSize(nLeaves);
            const zeros = getMerkleZeros(depth);

            const expected = referenceRoot(leaves, paddedSize);

            const tree = buildMerkleTree([...leaves], paddedSize, depth, zeros);
            expect(tree[0][0].equals(expected).toBoolean()).toBe(true);
        }
    );

    test.each([1, 3, 5, 6, 9, 17])(
        'regression_a2090_bruteforce_reference_foldMerkleLeft nLeaves=%i',
        (nLeaves) => {
            const pairs: Array<[Bytes32, Bytes32]> = [];
            for (let i = 0; i < nLeaves; i++) {
                pairs.push([dummyCodeChallenge(i), dummyValue(i)]);
            }
            const leaves = buildLeavesNonProvable(pairs);
            const { depth, paddedSize } =
                computeMerkleTreeDepthAndSize(nLeaves);
            const zeros = getMerkleZeros(depth);

            const expected = referenceRoot(leaves, paddedSize);

            const rootFold = foldMerkleLeft(
                [...leaves],
                paddedSize,
                depth,
                zeros
            );
            expect(rootFold.equals(expected).toBoolean()).toBe(true);
        }
    );

    test.each([1, 3, 5, 6, 9, 17])(
        'regression_a2090_o1js_merkle_tree_reference_buildMerkleTree nLeaves=%i',
        (nLeaves) => {
            const pairs: Array<[Bytes32, Bytes32]> = [];
            for (let i = 0; i < nLeaves; i++) {
                pairs.push([dummyCodeChallenge(i), dummyValue(i)]);
            }
            const leaves = buildLeavesNonProvable(pairs);
            const { depth, paddedSize } =
                computeMerkleTreeDepthAndSize(nLeaves);
            const zeros = getMerkleZeros(depth);

            const o1jsTree = new MerkleTree(depth + 1);
            for (let i = 0; i < nLeaves; i++) {
                o1jsTree.setLeaf(BigInt(i), leaves[i]);
            }
            const o1jsRoot = o1jsTree.getRoot();

            const tree = buildMerkleTree([...leaves], paddedSize, depth, zeros);
            expect(tree[0][0].equals(o1jsRoot).toBoolean()).toBe(true);
        }
    );

    test.each([1, 3, 5, 6, 9, 17])(
        'regression_a2090_o1js_merkle_tree_reference_foldMerkleLeft nLeaves=%i',
        (nLeaves) => {
            const pairs: Array<[Bytes32, Bytes32]> = [];
            for (let i = 0; i < nLeaves; i++) {
                pairs.push([dummyCodeChallenge(i), dummyValue(i)]);
            }
            const leaves = buildLeavesNonProvable(pairs);
            const { depth, paddedSize } =
                computeMerkleTreeDepthAndSize(nLeaves);
            const zeros = getMerkleZeros(depth);

            const o1jsTree = new MerkleTree(depth + 1);
            for (let i = 0; i < nLeaves; i++) {
                o1jsTree.setLeaf(BigInt(i), leaves[i]);
            }
            const o1jsRoot = o1jsTree.getRoot();

            const rootFold = foldMerkleLeft(
                [...leaves],
                paddedSize,
                depth,
                zeros
            );
            expect(rootFold.equals(o1jsRoot).toBoolean()).toBe(true);
        }
    );
});

describe('Merkle Fixed Tests', () => {
    test('test_large_slots', () => {
        const n = 1000;
        const pairs: Array<[Bytes32, Bytes32]> = [];
        for (let i = 0; i < n; i++) {
            pairs.push([dummyCodeChallenge(i), dummyValue(i)]);
        }
        const root = fullMerkleTest(pairs, 543);
        console.log("root", root.toBigInt());

    });

    test('test_hash_storage_slot_basic', () => {
        const codeChallenge = dummyCodeChallenge(2);
        const value = dummyValue(3);
        const leafHash = nonProvableStorageSlotLeafHash(codeChallenge, value);
        expect(leafHash.equals(Field(0)).toBoolean()).toBe(false);
    });

    test('test_all_leaf_counts_and_indices_with_build_and_fold', () => {
        const maxLeaves = 50;

        // Calculate max depth from maxLeaves
        const maxDepth = Math.ceil(Math.log2(maxLeaves)) || 1;

        // Precompute zeros
        const zeros = getMerkleZeros(maxDepth);

        console.log(
            'Testing all leaf counts and indices with both fold and build...'
        );

        for (let nLeaves = 0; nLeaves <= maxLeaves; nLeaves++) {
            console.log(`→ Testing with ${nLeaves} leaves`);

            const pairs: Array<[Bytes32, Bytes32]> = [];
            for (let i = 0; i < nLeaves; i++) {
                pairs.push([dummyCodeChallenge(i), dummyValue(i)]);
            }

            const leaves = buildLeavesNonProvable(pairs);
            console.log(
                `   leaves ${leaves.map((l) =>
                    l.toJSON().split('\n').join(' ,')
                )}`
            );
            const { depth, paddedSize } =
                computeMerkleTreeDepthAndSize(nLeaves);

            console.log(`   depth=${depth}, paddedSize=${paddedSize}`);

            const rootViaFold = foldMerkleLeft(
                leaves.slice(),
                paddedSize,
                depth,
                zeros
            );
            console.log(`   rootViaFold = ${rootViaFold}`);

            const merkleTree = buildMerkleTree(
                leaves,
                paddedSize,
                depth,
                zeros
            );
            console.log(`   rootViaBuild = ${merkleTree[0][0]}`);

            expect(merkleTree[0][0].equals(rootViaFold).toBoolean()).toBe(true);

            // Verify leaf layer padding
            const expectedPadded = leaves.slice();
            while (expectedPadded.length < paddedSize) {
                expectedPadded.push(Field(0));
            }
            expect(merkleTree[depth]).toEqual(expectedPadded);

            for (let index = 0; index < nLeaves; index++) {
                const leavesForPath = leaves.slice();

                const pathFold = getMerklePathFromLeaves(
                    leavesForPath,
                    paddedSize,
                    depth,
                    index,
                    zeros
                );
                const pathBuild = getMerklePathFromTree(merkleTree, index);

                expect(pathFold).toEqual(pathBuild);

                const leafHash = leaves[index];
                const recomputedRoot = computeMerkleRootFromPath(
                    leafHash,
                    index,
                    pathFold
                );

                expect(recomputedRoot.equals(rootViaFold).toBoolean()).toBe(
                    true
                );

                console.log(`     ✅ [nLeaves=${nLeaves}, index=${index}] OK`);
            }
        }
    });

    test('huge_timed_test', () => {
        const nLeaves = 1 << 16;

        console.log(`\n→ Testing with ${nLeaves} leaves`);

        const startTimeGetMerkleZeros = Date.now();
        const maxDepth = Math.ceil(Math.log2(nLeaves)) || 1;
        const zeros = getMerkleZeros(maxDepth);
        console.log(`01. getMerkleZeros: ${Date.now() - startTimeGetMerkleZeros}ms`);

        const startTimeGenerateDummyPairs = Date.now();
        const pairs: Array<[Bytes32, Bytes32]> = [];
        for (let i = 0; i < nLeaves; i++) {
            pairs.push([dummyCodeChallenge(i), dummyValue(i)]);
        }
        console.log(`02. Generate dummy pairs: ${Date.now() - startTimeGenerateDummyPairs}ms`);

        const startTimeBuildLeaves = Date.now();
        const leaves = buildLeavesNonProvable(pairs);
        console.log(`03. buildLeaves: ${Date.now() - startTimeBuildLeaves}ms`);

        const startTimeComputeDepthAndSize = Date.now();
        const { depth, paddedSize } = computeMerkleTreeDepthAndSize(nLeaves);
        console.log(`04. compute depth and padded size: ${Date.now() - startTimeComputeDepthAndSize}ms`);
        console.log(`   depth=${depth}, paddedSize=${paddedSize}`);

        const startTimeFoldMerkleLeft = Date.now();
        const rootViaFold = foldMerkleLeft(
            leaves.slice(),
            paddedSize,
            depth,
            zeros
        );
        console.log(`05. foldMerkleLeft: ${Date.now() - startTimeFoldMerkleLeft}ms`);
        console.log(`   rootViaFold = ${rootViaFold}`);

        const startTimeBuildMerkleTree = Date.now();
        const merkleTree = buildMerkleTree(leaves, paddedSize, depth, zeros);
        console.log(`06. buildMerkleTree: ${Date.now() - startTimeBuildMerkleTree}ms`);
        console.log(`   rootViaBuild = ${merkleTree[0][0]}`);

        expect(merkleTree[0][0].equals(rootViaFold).toBoolean()).toBe(true);

        const expectedPadded = leaves.slice();
        while (expectedPadded.length < paddedSize) {
            expectedPadded.push(Field(0));
        }
        expect(merkleTree[depth]).toEqual(expectedPadded);

        const index = nLeaves / 2;

        const startTimeGetPathFromLeaves = Date.now();
        const pathFold = getMerklePathFromLeaves(
            leaves.slice(),
            paddedSize,
            depth,
            index,
            zeros
        );
        console.log(`07. getMerklePathFromLeaves: ${Date.now() - startTimeGetPathFromLeaves}ms`);

        const startTimeGetPathFromTree = Date.now();
        const pathBuild = getMerklePathFromTree(merkleTree, index);
        console.log(`08. getMerklePathFromTree: ${Date.now() - startTimeGetPathFromTree}ms`);

        expect(pathFold).toEqual(pathBuild);

        const startTimeRecomputeRoot = Date.now();
        const leafHash = leaves[index];
        const recomputedRoot = computeMerkleRootFromPath(
            leafHash,
            index,
            pathFold
        );
        console.log(`09. recompute root from path: ${Date.now() - startTimeRecomputeRoot}ms`);

        expect(recomputedRoot.equals(rootViaFold).toBoolean()).toBe(true);

        console.log(`     ✅ [nLeaves=${nLeaves}, index=${index}] OK`);
    });
});
