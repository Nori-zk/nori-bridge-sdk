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
    dummyAttestation,
    dummyValue,
    nonProvableStorageSlotLeafHash,
} from './testUtils.js';

// Full Merkle lifecycle test using actual hashed leaves and leaf index
function fullMerkleTest(
    triples: Array<[Bytes20, Bytes32, Bytes32]>,
    leafIndex: number
): Field {
    const leaves = buildLeavesNonProvable(triples);
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

describe('Merkle Fixed Tests', () => {
    test('test_large_slots', () => {
        const n = 1000;
        const triples: Array<[Bytes20, Bytes32, Bytes32]> = [];
        for (let i = 0; i < n; i++) {
            triples.push([dummyAddress(i), dummyAttestation(i), dummyValue(i)]);
        }
        const root = fullMerkleTest(triples, 543);
        console.log("root", root.toBigInt());

    });

    test('test_hash_storage_slot_basic', () => {
        const address = dummyAddress(1);
        const attestation = dummyAttestation(2);
        const value = dummyValue(3);
        const leafHash = nonProvableStorageSlotLeafHash(address, attestation, value);
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

            const triples: Array<[Bytes20, Bytes32, Bytes32]> = [];
            for (let i = 0; i < nLeaves; i++) {
                triples.push([dummyAddress(i), dummyAttestation(i), dummyValue(i)]);
            }

            const leaves = buildLeavesNonProvable(triples);
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

        const startTimeGenerateDummyTriples = Date.now();
        const triples: Array<[Bytes20, Bytes32, Bytes32]> = [];
        for (let i = 0; i < nLeaves; i++) {
            triples.push([dummyAddress(i), dummyAttestation(i), dummyValue(i)]);
        }
        console.log(`02. Generate dummy triples: ${Date.now() - startTimeGenerateDummyTriples}ms`);

        const startTimeBuildLeaves = Date.now();
        const leaves = buildLeavesNonProvable(triples);
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
