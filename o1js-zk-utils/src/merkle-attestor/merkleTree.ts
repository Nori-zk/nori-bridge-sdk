import { Field, Poseidon } from 'o1js';

/**
 * Compute next power of two >= n
 */
export function nextPowerOfTwo(n: number): number {
    if (n <= 1) return 1;
    return 1 << (32 - Math.clz32(n - 1));
}

/**
 * Compute depth and padded size for Merkle tree
 */
export function computeMerkleTreeDepthAndSize(nLeaves: number): {
    depth: number;
    paddedSize: number;
} {
    const paddedSize = nextPowerOfTwo(nLeaves);
    const depth = Math.log2(paddedSize);
    return { depth, paddedSize };
}

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

/**
 * Build full Merkle tree layers (root at index 0, leaves at index depth)
 * @param merkleLeaves Unpadded leaves as Field[]
 * @param paddedSize number, power of two >= merkleLeaves.length
 * @param depth number, log2(paddedSize)
 * @param zeros precomputed zero hashes per level (length depth + 1)
 * @returns Field[][], each element a layer of the tree, from root (0) to leaves (depth)
 */ /**
 * Build the full Merkle tree from leaves, padding and folding with zeros cache.
 * @param merkleLeaves Field[] initial leaves (unpadded)
 * @param paddedSize number padded size (power of two)
 * @param depth number tree depth
 * @param zeros Field[] array of zero hashes for each level
 * @returns Field[][] full Merkle tree, root at index 0, leaves at depth index
 */
export function buildMerkleTree(
    merkleLeaves: Field[],
    paddedSize: number,
    depth: number,
    zeros: Field[]
): Field[][] {
    const nLeaves = merkleLeaves.length;
    const missing = paddedSize - nLeaves;

    // Clone and pad leaves
    const leaves = merkleLeaves.slice();
    for (let i = 0; i < missing; i++) {
        leaves.push(Field(0));
    }

    const merkleTree: Field[][] = new Array(depth + 1);
    merkleTree[depth] = leaves;

    let nNonDummyNodes = nLeaves;

    // Build tree from leaves upward
    for (let level = depth; level > 0; level--) {
        const childLevel = merkleTree[level];
        const parentWidth = 1 << (level - 1);
        const parentLevel: Field[] = new Array(parentWidth);

        for (let i = 0; i < parentWidth; i++) {
            const leftIdx = 2 * i;

            if (leftIdx >= nNonDummyNodes) {
                // Both left and right dummy nodes, use zeros cache
                parentLevel[i] = zeros[level];
            } else {
                const rightIdx = leftIdx + 1;
                // Atleast one of left and right are real.
                parentLevel[i] = Poseidon.hash([
                    childLevel[leftIdx],
                    childLevel[rightIdx],
                ]);
            }
        }

        merkleTree[level - 1] = parentLevel;

        // Shrink count of non-dummy nodes for next iteration
        nNonDummyNodes = Math.floor((nNonDummyNodes + 1) / 2);
    }

    return merkleTree;
}

/**
 * Fold Merkle tree bottom-up to get root; modifies leaves in-place.
 * @param leaves Field[], initial leaves (unpadded), will be padded in-place
 * @param paddedSize number, total size padded to power of two
 * @param depth number, tree depth
 * @param zeros Field[] array of zero hashes per level
 * @returns Field root hash
 */
export function foldMerkleLeft(
    leaves: Field[],
    paddedSize: number,
    depth: number,
    zeros: Field[]
): Field {
    if (leaves.length === 0) {
        return Field(0);
    }

    const nLeaves = leaves.length;

    // Pad leaves to paddedSize with zeros
    const missing = paddedSize - nLeaves;
    for (let i = 0; i < missing; i++) {
        leaves.push(Field(0));
    }

    let nNonDummyNodes = nLeaves;

    // Iterate from top tree level down to leaves
    for (let level = depth; level > 0; level--) {
        const levelWidth = 1 << level; // 2^level
        const parentWidth = levelWidth >> 1; // half the level width

        for (let i = 0; i < parentWidth; i++) {
            const leftIdx = 2 * i;

            if (leftIdx >= nNonDummyNodes) {
                // Both left and right are dummy nodes — use cached zero for this level
                leaves[i] = zeros[level];
            } else {
                // Atleast one of left and right are real.
                const rightIdx = leftIdx + 1;
                leaves[i] = Poseidon.hash([leaves[leftIdx], leaves[rightIdx]]);
            }
        }

        // Shrink non-dummy node count as we move up the tree
        nNonDummyNodes = Math.floor((nNonDummyNodes + 1) / 2);
    }

    return leaves[0];
}

/**
 * Compute the Merkle path (sibling nodes) for a given leaf index from
 * a list of leaves.
 *
 * This function mutates and extends the provided `merkleLeaves` array
 * by padding it to `paddedSize` with zeros, then folds the tree upwards,
 * storing intermediate hashes back into the same array.
 *
 * It returns the vector of sibling hashes from the leaf level up to the root.
 *
 * @param merkleLeaves Mutable array of leaf node hashes (Field elements)
 * @param paddedSize Size to which leaves should be padded (power of two)
 * @param depth Depth of the Merkle tree
 * @param index Leaf index for which to compute the Merkle path
 * @param zeros Array of zero hashes per level for dummy nodes (length >= depth + 1)
 * @returns Array of sibling hashes (Field[]) forming the Merkle path
 */
export function getMerklePathFromLeaves(
    merkleLeaves: Field[],
    paddedSize: number,
    depth: number,
    index: number,
    zeros: Field[]
): Field[] {
    if (merkleLeaves.length === 0) {
        return [];
    }

    // Number of real leaves before padding
    const nLeaves = merkleLeaves.length;

    // Pad leaves with zeros to the padded size
    const missing = paddedSize - nLeaves;
    for (let i = 0; i < missing; i++) {
        merkleLeaves.push(Field(0));
    }

    // Reuse the same array to store intermediate hashes
    const merkleNodes = merkleLeaves;

    const path: Field[] = [];
    let position = index;
    let nNonDummyNodes = nLeaves;

    // Iterate from tree bottom (level = depth) to top (level = 1)
    for (let level = depth; level >= 1; level--) {
        const siblingIndex = position % 2 === 1 ? position - 1 : position + 1;

        // Sibling node on the same level
        const sibling = merkleNodes[siblingIndex];
        path.push(sibling);

        const levelWidth = 1 << level; // 2^level nodes at current level

        // Compute parent nodes by hashing pairs of children
        for (let i = 0; i < levelWidth / 2; i++) {
            const leftIdx = 2 * i;

            if (leftIdx >= nNonDummyNodes) {
                // Both left and right are dummy nodes; use zero hash for this level
                merkleNodes[i] = zeros[level];
            } else {
                const rightIdx = leftIdx + 1;
                // Atleast one of left and right are real.
                merkleNodes[i] = Poseidon.hash([
                    merkleNodes[leftIdx],
                    merkleNodes[rightIdx],
                ]);
            }
        }

        // Move to the next level up
        position = Math.floor(position / 2);
        nNonDummyNodes = Math.floor((nNonDummyNodes + 1) / 2);
    }

    return path;
}

/**
 * Compute the Merkle path (sibling nodes) for a leaf index from a fully built Merkle tree.
 *
 * Assumes the Merkle tree is represented as an array of levels,
 * where `merkleTree[0]` is the root level (1 node),
 * and `merkleTree[depth]` is the leaf level.
 *
 * @param merkleTree Array of tree levels, each a Field[] array of nodes
 * @param index Leaf index for which to compute the Merkle path
 * @returns Array of sibling hashes (Field[]) forming the Merkle path
 */
export function getMerklePathFromTree(
    merkleTree: Field[][],
    index: number
): Field[] {
    const depth = merkleTree.length - 1;
    const path: Field[] = [];
    let pos = index;

    // Traverse from leaf level up to root (levels: depth → 1)
    for (let level = depth; level >= 1; level--) {
        const sibling = pos ^ 1; // bitwise sibling index
        path.push(merkleTree[level][sibling]);
        pos = Math.floor(pos / 2);
    }

    return path;
}

/**
 * Compute Merkle root from leaf hash, leaf index, and Merkle path
 * @param leafHash Field
 * @param index number leaf index
 * @param path Field[] sibling nodes
 * @returns Field root hash
 */
export function computeMerkleRootFromPath(
    leafHash: Field,
    index: number,
    path: Field[]
): Field {
    let acc = leafHash;
    let pos = index;

    for (const sibling of path) {
        if ((pos & 1) === 0) {
            acc = Poseidon.hash([acc, sibling]);
        } else {
            acc = Poseidon.hash([sibling, acc]);
        }
        pos >>= 1;
    }

    return acc;
}
