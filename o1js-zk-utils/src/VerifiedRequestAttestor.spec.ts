import { Logger, LogPrinter } from 'esm-iso-logger';
import {
    VerifiedRequestAttestorInput,
    VerifiedRequestAttestor,
    buildVerifiedRequestLeaves,
    getVerifiedRequestWitness,
    VerifiedRequest,
    provableRequestLeafHash,
    MAX_COLLECTION_KEYS,
} from './VerifiedRequestAttestor.js';
import { sp1ConsensusMPTPlonkProof as _sp1ConsensusMPTPlonkProof } from './test-examples/sp1-mpt-proof/sp1ProofMessage.js';
import { Bytes20, Bytes32 } from './types.js';
import {
    computeMerkleTreeDepthAndSize,
    foldMerkleLeft,
    getMerkleZeros,
} from './merkle-attestor/merkleTree.js';
import { UInt64, UInt8 } from 'o1js';
import {
    createTimer,
    decodeConsensusMptProof,
    uint8ArrayToBigIntBE,
} from './utils.js';
import { type VerifiedRequest as VerifiedRequestJson } from '@nori-zk/pts-types';

const sp1ConsensusMPTPlonkProof = _sp1ConsensusMPTPlonkProof as typeof _sp1ConsensusMPTPlonkProof & {verified_requests: VerifiedRequestJson[]};

const logger = new Logger('VerifiedRequestAttestor');
new LogPrinter('TestO1JsZkUtils');

describe('Verified Request Attestor Test', () => {
    test('verified_request_pipeline', async () => {
        // Analyse zk program
        const verifiedRequestAttestorAnalysis =
            await VerifiedRequestAttestor.analyzeMethods();
        logger.log(
            `VerifiedRequestAttestor analyze methods gates length '${verifiedRequestAttestorAnalysis.compute.gates.length}'.`
        );

        // Build zk program
        const { verificationKey } = await VerifiedRequestAttestor.compile({
            forceRecompile: true,
        });
        logger.log(
            `VerifiedRequestAttestor contract compiled vk: '${verificationKey.hash}'.`
        );

        // Build VerifiedRequest structs from sp1 mpt message.
        const verifiedRequests = sp1ConsensusMPTPlonkProof.verified_requests.map(
            (slot) => {
                const collectionKeys = Array.from(
                    { length: MAX_COLLECTION_KEYS },
                    (_unused, i) =>
                        Bytes32.fromHex(
                            (slot.collection_keys[i] ?? `0x${'0'.repeat(64)}`)
                                .slice(2)
                                .padStart(64, '0')
                        )
                );
                return new VerifiedRequest({
                    target: Bytes20.fromHex(
                        slot.target.slice(2).padStart(40, '0')
                    ),
                    collectionKeysCount: UInt8.from(slot.collection_keys_count),
                    collectionKeys,
                    value: Bytes32.fromHex(
                        slot.value.slice(2).padStart(64, '0')
                    ),
                });
            }
        );

        // Build leaves
        const leaves = buildVerifiedRequestLeaves(verifiedRequests);

        // Pick an index
        let index = sp1ConsensusMPTPlonkProof.verified_requests.length - 1;

        // Find Value
        const slotToFind = verifiedRequests.find((_, idx) => idx === index);

        if (!slotToFind) throw new Error(`Slot at ${index} not found`);

        console.log(
            'provableRequestLeafHash',
            provableRequestLeafHash(slotToFind).toBigInt().toString(16)
        );

        // Compute path
        const path = getVerifiedRequestWitness([...leaves], index);

        //console.log('path', path._dummyMask());

        // Compute root
        const { depth, paddedSize } = computeMerkleTreeDepthAndSize(
            leaves.length
        );
        const rootHash = foldMerkleLeft(
            leaves,
            paddedSize,
            depth,
            getMerkleZeros(depth)
        );

        // Build ZK input
        const input = new VerifiedRequestAttestorInput({
            path,
            index: UInt64.from(index),
            value: slotToFind,
        });

        logger.log(`Generated input ${JSON.stringify(input)}`);

        // Prove deposit with sample data.
        const timer = createTimer();
        const output = await VerifiedRequestAttestor.compute(input);
        logger.log(`VerifiedRequestAttestor.compute took ${timer()}`);

        const decodedProof = decodeConsensusMptProof(
            sp1ConsensusMPTPlonkProof.proof
        );

        const decodedProofVerifiedRequestsRootBigInt = uint8ArrayToBigIntBE( // Could do LE without the reverse FIXME
            decodedProof.verifiedRequestsRoot.toBytes().reverse()
        );

        console.log(
            decodedProofVerifiedRequestsRootBigInt,//.toString(16),
            output.proof.publicOutput.toBigInt(),//.toString(16),
            rootHash.toBigInt(),//.toString(16)
        );

        expect(output.proof.publicOutput.toBigInt()).toBe(rootHash.toBigInt());
        expect(decodedProofVerifiedRequestsRootBigInt).toEqual(output.proof.publicOutput.toBigInt());
    });
});
