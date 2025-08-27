import { UInt64 } from 'o1js';
import { merkleLeafAttestorGenerator } from './merkleLeafAttestor.js';
import { Bytes20, Bytes32 } from '../types.js';
import { Logger, LogPrinter, wordToBytes } from '@nori-zk/proof-conversion';
import {
    computeMerkleTreeDepthAndSize,
    foldMerkleLeft,
    getMerkleZeros,
} from './merkleTree.js';
import {
    buildLeavesNonProvable,
    dummyAddress,
    dummyAttestation,
    dummyValue,
    nonProvableStorageSlotLeafHash,
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
    test('compute_non_provable_storage_slot_leaf_hash', () => {
        const slot = {
            slot_key_address: '0xc7e910807dd2e3f49b34efe7133cfb684520da69',
            slot_nested_key_attestation_hash:
                '0x2f000000000000000000000000000000000000000000000000038d7ec293e52f',
            value: '0xe8d4a51000',
        };

        console.log(slot);

        // FIXME probably all need to be padded
        const addr = Bytes20.fromHex(slot.slot_key_address.slice(2));
        const attestation = Bytes32.fromHex(
            slot.slot_nested_key_attestation_hash.slice(2).padStart(64, '0')
        );
        const valuePad = slot.value.slice(2).padStart(64, '0');
        console.log('padded value', valuePad);
        const value = Bytes32.fromHex(valuePad);

        const hash = nonProvableStorageSlotLeafHash(addr, attestation, value);

        console.log(`Hash result big int: ${hash.toBigInt()}`);
        console.log(
            `Hash result bytes: ${wordToBytes(hash, 32).map((byte) =>
                byte.toNumber()
            )}`
        );
        console.log(
            `Hash result hex: ${wordToBytes(hash, 32)
                .map((byte) => byte.toNumber().toString(16).padStart(2, '0'))
                .join('')}`
        );

        const hash2 = provableLeafContentsHash(
            new ProvableLeafObject({ address: addr, attestation, value })
        );

        console.log('Provable hash result', hash2.toBigInt().toString());
        console.log(
            `Provable hash result hex: ${wordToBytes(hash2, 32)
                .map((byte) => byte.toNumber().toString(16).padStart(2, '0'))
                .join('')}`
        );
    });

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

            const triples: Array<[Bytes20, Bytes32, Bytes32]> = [];
            for (let i = 0; i < nLeaves; i++) {
                triples.push([
                    dummyAddress(i),
                    dummyAttestation(i),
                    dummyValue(i),
                ]);
            }

            const leafObjects: ProvableLeafObject[] = [];
            for (let i = 0; i < nLeaves; i++) {
                leafObjects.push(
                    new ProvableLeafObject({
                        address: triples[i][0],
                        attestation: triples[i][1],
                        value: triples[i][2],
                    })
                );
            }

            const leaves = buildLeaves(leafObjects);

            console.log(
                `   leaves ${leaves.map((l) =>
                    l.toJSON().split('\n').join(' ,')
                )}`
            );

            const rustLeaves = buildLeavesNonProvable(triples);

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

    test('huge_2pow16_leaves_provable_test', async () => {
        const merkleTreeLeafAttestorAnalysis =
            await MerkleTreeLeafAttestor.analyzeMethods();
        logger.log(
            `MerkleTreeLeafAttestor analyze methods gates length '${merkleTreeLeafAttestorAnalysis.compute.gates.length}'.`
        );

        const { verificationKey } = await MerkleTreeLeafAttestor.compile({
            forceRecompile: true,
        });
        logger.log(
            `MerkleTreeLeafAttestor contract compiled vk: '${verificationKey.hash}'.`
        );

        const nLeaves = 2 ** 16; // 65536
        console.log(
            `Building ${nLeaves} provable leaves (this may use significant memory)...`
        );

        const triples = new Array(nLeaves);
        for (let i = 0; i < nLeaves; i++) {
            triples[i] = [dummyAddress(i), dummyAttestation(i), dummyValue(i)];
        }

        const leafObjects = new Array(nLeaves);
        for (let i = 0; i < nLeaves; i++) {
            leafObjects[i] = new ProvableLeafObject({
                address: triples[i][0],
                attestation: triples[i][1],
                value: triples[i][2],
            });
        }

        const leaves = buildLeaves(leafObjects);
        const { depth, paddedSize } = computeMerkleTreeDepthAndSize(nLeaves);
        const zeros = getMerkleZeros(depth);

        console.log(`   depth=${depth}, paddedSize=${paddedSize}`);

        const rustLeaves = buildLeavesNonProvable(triples);
        const rootViaFold = foldMerkleLeft(
            rustLeaves,
            paddedSize,
            depth,
            zeros
        );
        console.log(`   rootViaFold = ${rootViaFold.toBigInt()}`);

        const indicesToCheck = [
            0,
            1,
            Math.floor(nLeaves / 2),
            nLeaves - 2,
            nLeaves - 1,
        ];

        for (const index of indicesToCheck) {
            console.log(`Verifying index ${index} / ${nLeaves}`);

            const pathFold = getMerklePathFromLeaves(leaves.slice(), index);
            const slotToFind = leafObjects[index];

            const input = new MerkleTreeLeafAttestorInput({
                rootHash: rootViaFold,
                path: pathFold,
                index: UInt64.from(index),
                value: slotToFind,
            });

            const t0 = Date.now();
            const output = await MerkleTreeLeafAttestor.compute(input);
            const t1 = Date.now();

            expect(output.proof.publicOutput.toBigInt()).toBe(
                rootViaFold.toBigInt()
            );

            console.log(
                `     ✅ [nLeaves=${nLeaves}, index=${index}] OK (took ${
                    t1 - t0
                } ms)`
            );
        }
    }, 1000000000);
});
