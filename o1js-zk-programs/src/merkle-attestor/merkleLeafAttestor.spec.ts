import { UInt64 } from 'o1js';
import { merkleLeafAttestorGenerator } from './merkleLeafAttestor.js';
import { Bytes20, Bytes32 } from '../types.js';
import { Logger, LogPrinter } from '@nori-zk/proof-conversion';
import {
    computeMerkleTreeDepthAndSize,
    foldMerkleLeft,
    getMerkleZeros,
} from './merkleTree.js';
import {
    buildLeavesNonProvable,
    dummyAddress,
    dummyValue,
    provableLeafContentsHash,
    ProvableLeafObject,
} from './testUtils.js';

const logger = new Logger('TestMerkle');
new LogPrinter('[TestEthProcessor]', [
    'log',
    'info',
    'warn',
    'error',
    'debug',
    'fatal',
    'verbose',
]);

const {
    MerkleTreeLeafAttestorInput,
    MerkleTreeLeafAttestor,
    buildLeaves,
    getMerklePathFromLeaves,
} = merkleLeafAttestorGenerator(
    16,
    'MyMerkleVerifier',
    ProvableLeafObject,
    provableLeafContentsHash
);

describe('Merkle Attestor Test', () => {
    test('test_all_leaf_counts_and_indices_with_pipeline', async () => {
        // Analyse zk program
        const merkleTreeLeafAttestorAnalysis =
            await MerkleTreeLeafAttestor.analyzeMethods();
        logger.log(
            `MerkleTreeLeafAttestor analyze methods gates length '${merkleTreeLeafAttestorAnalysis.compute.gates.length}'.`
        );

        // Build zk program
        const { verificationKey } = await MerkleTreeLeafAttestor.compile({
            forceRecompile: true,
        });
        logger.log(
            `MerkleTreeLeafAttestor contract compiled vk: '${verificationKey.hash}'.`
        );

        const maxLeaves = 10;
        const maxDepth = Math.ceil(Math.log2(maxLeaves)) || 1;
        const zeros = getMerkleZeros(maxDepth);

        console.log(
            'Testing all leaf counts and indices with both fold and circuit...'
        );

        for (let nLeaves = 0; nLeaves <= maxLeaves; nLeaves++) {
            console.log(`→ Testing with ${nLeaves} leaves`);

            const pairs: Array<[Bytes20, Bytes32]> = [];
            for (let i = 0; i < nLeaves; i++) {
                pairs.push([dummyAddress(i), dummyValue(i)]);
            }

            const leafObjects: ProvableLeafObject[] = [];
            for (let i = 0; i < nLeaves; i++) {
                leafObjects.push(
                    new ProvableLeafObject({
                        bytes20: pairs[i][0],
                        bytes32: pairs[i][1],
                    })
                );
            }

            const leaves = buildLeaves(leafObjects);

            console.log(
                `   leaves ${leaves.map((l) =>
                    l.toJSON().split('\n').join(' ,')
                )}`
            );

            const rustLeaves = buildLeavesNonProvable(pairs);

            const { depth, paddedSize } =
                computeMerkleTreeDepthAndSize(nLeaves);
            console.log(`   depth=${depth}, paddedSize=${paddedSize}`);

            /*console.log(
                    'LEAVES COMPARISON',
                    JSON.stringify(leaves),
                    JSON.stringify(rustLeaves)
                );*/
            expect(leaves).toEqual(rustLeaves);

            const rootViaFold = foldMerkleLeft(
                rustLeaves,
                paddedSize,
                depth,
                zeros
            );
            console.log(`   rootViaFold = ${rootViaFold}`);

            for (let index = 0; index < nLeaves; index++) {
                const pathFold = getMerklePathFromLeaves(leaves.slice(), index);

                const slotToFind = leafObjects[index];

                const input = new MerkleTreeLeafAttestorInput({
                    rootHash: rootViaFold,
                    path: pathFold,
                    index: UInt64.from(index),
                    value: slotToFind,
                });

                const output = await MerkleTreeLeafAttestor.compute(input);
                expect(output.proof.publicOutput.toBigInt()).toBe(
                    rootViaFold.toBigInt()
                );

                console.log(`     ✅ [nLeaves=${nLeaves}, index=${index}] OK`);
            }
        }
    }, 1000000000);
});
