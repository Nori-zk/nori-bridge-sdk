import { Field } from 'o1js';
import {
    computeMerkleTreeDepthAndSize,
    getMerkleZeros,
    buildMerkleTree,
    foldMerkleLeft,
    getMerklePathFromTree,
    computeMerkleRootFromPath,
    getMerklePathFromLeaves,
} from './merkleTree.js';
import { Bytes20, Bytes32 } from '../types.js';
import {
    buildLeavesNonProvable,
    dummyAddress,
    dummyValue,
    nonProvableStorageSlotLeafHash,
} from './testUtils.js';

// Full Merkle lifecycle test using actual hashed leaves and leaf index
function fullMerkleTest(
    pairs: Array<[Bytes20, Bytes32]>,
    leafIndex: number
): void {
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
}

describe('Merkle Fixed Tests', () => {
    test('test_large_slots', () => {
        const n = 1000;
        const pairs: Array<[Bytes20, Bytes32]> = [];
        for (let i = 0; i < n; i++) {
            pairs.push([dummyAddress(i), dummyValue(i)]);
        }
        fullMerkleTest(pairs, 543);
    });

    test('test_hash_storage_slot_basic', () => {
        const address = dummyAddress(1);
        const value = dummyValue(2);
        const leafHash = nonProvableStorageSlotLeafHash(address, value);
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

            const pairs: Array<[Bytes20, Bytes32]> = [];
            for (let i = 0; i < nLeaves; i++) {
                pairs.push([dummyAddress(i), dummyValue(i)]);
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

        console.time('01. getMerkleZeros');
        const maxDepth = Math.ceil(Math.log2(nLeaves)) || 1;
        const zeros = getMerkleZeros(maxDepth);
        console.timeEnd('01. getMerkleZeros');

        console.time('02. Generate dummy pairs');
        const pairs: Array<[Bytes20, Bytes32]> = [];
        for (let i = 0; i < nLeaves; i++) {
            pairs.push([dummyAddress(i), dummyValue(i)]);
        }
        console.timeEnd('02. Generate dummy pairs');

        console.time('03. buildLeaves');
        const leaves = buildLeavesNonProvable(pairs);
        console.timeEnd('03. buildLeaves');

        console.time('04. compute depth and padded size');
        const { depth, paddedSize } = computeMerkleTreeDepthAndSize(nLeaves);
        console.timeEnd('04. compute depth and padded size');
        console.log(`   depth=${depth}, paddedSize=${paddedSize}`);

        console.time('05. foldMerkleLeft');
        const rootViaFold = foldMerkleLeft(
            leaves.slice(),
            paddedSize,
            depth,
            zeros
        );
        console.timeEnd('05. foldMerkleLeft');
        console.log(`   rootViaFold = ${rootViaFold}`);

        console.time('06. buildMerkleTree');
        const merkleTree = buildMerkleTree(leaves, paddedSize, depth, zeros);
        console.timeEnd('06. buildMerkleTree');
        console.log(`   rootViaBuild = ${merkleTree[0][0]}`);

        expect(merkleTree[0][0].equals(rootViaFold).toBoolean()).toBe(true);

        const expectedPadded = leaves.slice();
        while (expectedPadded.length < paddedSize) {
            expectedPadded.push(Field(0));
        }
        expect(merkleTree[depth]).toEqual(expectedPadded);

        const index = nLeaves / 2;

        console.time('07. getMerklePathFromLeaves');
        const pathFold = getMerklePathFromLeaves(
            leaves.slice(),
            paddedSize,
            depth,
            index,
            zeros
        );
        console.timeEnd('07. getMerklePathFromLeaves');

        console.time('08. getMerklePathFromTree');
        const pathBuild = getMerklePathFromTree(merkleTree, index);
        console.timeEnd('08. getMerklePathFromTree');

        expect(pathFold).toEqual(pathBuild);

        console.time('09. recompute root from path');
        const leafHash = leaves[index];
        const recomputedRoot = computeMerkleRootFromPath(
            leafHash,
            index,
            pathFold
        );
        console.timeEnd('09. recompute root from path');

        expect(recomputedRoot.equals(rootViaFold).toBoolean()).toBe(true);

        console.log(`     ✅ [nLeaves=${nLeaves}, index=${index}] OK`);
    });
});
