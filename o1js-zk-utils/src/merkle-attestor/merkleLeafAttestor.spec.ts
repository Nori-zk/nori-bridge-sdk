import { UInt64, UInt8 } from 'o1js';
import { merkleLeafAttestorGenerator } from './merkleLeafAttestor.js';
import { Bytes20, Bytes32 } from '../types.js';
import { Logger, LogPrinter } from 'esm-iso-logger';
import { fieldToBytesLE } from '../utils.js';
import {
    computeMerkleTreeDepthAndSize,
    foldMerkleLeft,
    getMerkleZeros,
} from './merkleTree.js';
import {
    buildVerifiedRequestLeavesNonProvable,
    dummyRequest,
    nonProvableRequestLeafHash,
    toVerifiedRequest,
    type DummyRequest,
} from './testUtils.js';
import {
    VerifiedRequest,
    provableRequestLeafHash,
} from '../ContractDepositAttestor.js';

const logger = new Logger('TestMerkle');
new LogPrinter('TestO1JsZkUtils');

const {
    MerkleTreeLeafAttestorInput,
    MerkleTreeLeafAttestor,
    buildLeaves,
    getMerklePathFromLeaves,
} = merkleLeafAttestorGenerator(
    16,
    'MyMerkleVerifier',
    VerifiedRequest,
    provableRequestLeafHash
);

describe('Merkle Attestor Test', () => {
    test('compute_non_provable_request_leaf_hash', () => {
        const slot = {
            slot_key_code_challenge:
                '0x2f000000000000000000000000000000000000000000000000038d7ec293e52f',
            value: '0xe8d4a51000',
        };

        console.log(slot);

        // FIXME probably all need to be padded
        const codeChallenge = Bytes32.fromHex(
            slot.slot_key_code_challenge.slice(2).padStart(64, '0')
        );
        const valuePad = slot.value.slice(2).padStart(64, '0');
        console.log('padded value', valuePad);
        const value = Bytes32.fromHex(valuePad);

        const target = Bytes20.zero;
        const collectionKeys: [Bytes32, Bytes32] = [codeChallenge, Bytes32.zero];

        const hash = nonProvableRequestLeafHash(target, 1, collectionKeys, value);

        console.log(`Hash result big int: ${hash.toBigInt()}`);
        console.log(
            `Hash result bytes: ${fieldToBytesLE(hash).map((byte) =>
                byte.toNumber()
            )}`
        );
        console.log(
            `Hash result hex: ${fieldToBytesLE(hash)
                .map((byte) => byte.toNumber().toString(16).padStart(2, '0'))
                .join('')}`
        );

        const hash2 = provableRequestLeafHash(
            new VerifiedRequest({
                target,
                collectionKeysCount: UInt8.from(1),
                collectionKeys,
                value,
            })
        );

        console.log('Provable hash result', hash2.toBigInt().toString());
        console.log(
            `Provable hash result hex: ${fieldToBytesLE(hash2)
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

            const requests: DummyRequest[] = [];
            for (let i = 0; i < nLeaves; i++) {
                requests.push(dummyRequest(i));
            }

            const leafObjects: VerifiedRequest[] = requests.map(
                toVerifiedRequest
            );

            const leaves = buildLeaves(leafObjects);

            console.log(
                `   leaves ${leaves.map((l) =>
                    l.toJSON().split('\n').join(' ,')
                )}`
            );

            const rustLeaves = buildVerifiedRequestLeavesNonProvable(requests);

            const { depth, paddedSize } =
                computeMerkleTreeDepthAndSize(nLeaves);
            console.log(`   depth=${depth}, paddedSize=${paddedSize}`);

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

        const requests: DummyRequest[] = new Array(nLeaves);
        for (let i = 0; i < nLeaves; i++) {
            requests[i] = dummyRequest(i);
        }

        const leafObjects: VerifiedRequest[] = new Array(nLeaves);
        for (let i = 0; i < nLeaves; i++) {
            leafObjects[i] = toVerifiedRequest(requests[i]);
        }

        const leaves = buildLeaves(leafObjects);
        const { depth, paddedSize } = computeMerkleTreeDepthAndSize(nLeaves);
        const zeros = getMerkleZeros(depth);

        console.log(`   depth=${depth}, paddedSize=${paddedSize}`);

        const rustLeaves = buildVerifiedRequestLeavesNonProvable(requests);
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
