import {
    createTimer,
    Bytes20,
    Bytes32,
    computeMerkleTreeDepthAndSize,
    getMerklePathFromLeaves,
    getMerkleZeros,
    MAX_COLLECTION_KEYS,
    provableRequestLeafHash,
    VerifiedRequest,
} from '@nori-zk/o1js-zk-utils';
import { DynamicArray } from '@nori-zk/mina-attestations/dynamic/array';
import { type Sp1ProofAndConvertedProofBundle } from '@nori-zk/pts-types';
import { Field, Poseidon, Provable, Struct, UInt64, UInt8 } from 'o1js';
import { Logger } from 'esm-iso-logger';
// ------- Deposit attestation ---------------------------------

const logger = new Logger('DepositAttestation');

// The leaf struct and its hash are defined once in o1js-zk-utils; both must
// stay byte-identical to the SP1 guest, so they have a single owner. Re-exported
// here because the mint path and its tests consume them through this module.
export { VerifiedRequest, provableRequestLeafHash };

const treeDepth = 16;

export const MerklePath = DynamicArray(Field, { maxLength: treeDepth });

export class VerifiedRequestWitnessInput extends Struct({
    path: MerklePath,
    index: UInt64,
    value: VerifiedRequest,
}) { }

/** One entry of a proven batch, as carried by the proof bundle. */
export type VerifiedRequestJson = {
    target: string;
    collectionKeysCount: number;
    collectionKeys: string[];
    value: string;
};

export type VerifiedRequestWitnessInputJson = {
    depositIndex: number;
    despositSlotRaw: VerifiedRequestJson;
    path: string[];
};

/** Pads `collectionKeys` out to the fixed width the leaf hash expects. */
export function verifiedRequestFromJson(json: VerifiedRequestJson) {
    const collectionKeys = Array.from(
        { length: MAX_COLLECTION_KEYS },
        (_unused, i) =>
            Bytes32.fromHex(
                (json.collectionKeys[i] ?? `0x${'0'.repeat(64)}`).slice(2)
            )
    );

    return new VerifiedRequest({
        target: Bytes20.fromHex(json.target.slice(2)),
        collectionKeysCount: UInt8.from(json.collectionKeysCount),
        collectionKeys,
        value: Bytes32.fromHex(json.value.slice(2)),
    });
}

export function buildVerifiedRequestWitnessInput(
    jsonInputs: VerifiedRequestWitnessInputJson
) {
    const merklePath = MerklePath.from([]);
    jsonInputs.path.forEach((element) =>
        merklePath.push(new Field(BigInt(element)))
    );
    return new VerifiedRequestWitnessInput({
        path: merklePath,
        index: UInt64.fromValue(jsonInputs.depositIndex),
        value: verifiedRequestFromJson(jsonInputs.despositSlotRaw),
    });
}

export function getVerifiedRequestSlotRootFromWitness(
    input: VerifiedRequestWitnessInput
) {
    let { index, path } = input;

    let currentHash = provableRequestLeafHash(input.value);

    const bitPath = index.value.toBits(path.maxLength);
    path.forEach((sibling, isDummy, i) => {
        const bit = bitPath[i];

        const left = Provable.if(bit, Field, sibling, currentHash);
        const right = Provable.if(bit, Field, currentHash, sibling);
        const nextHash = Poseidon.hash([left, right]);

        /*Provable.asProver(() => {
            if (!isDummy) {
                console.log(
                    `merkle pair @ level ${i}:`,
                    'left =',
                    typeof left.toBigInt === 'function'
                        ? left.toBigInt()
                        : left,
                    'right =',
                    typeof right.toBigInt === 'function'
                        ? right.toBigInt()
                        : right
                );
            }
        });*/

        currentHash = Provable.if(isDummy, Field, currentHash, nextHash);
    });

    return currentHash;
}

/**
 * Reads the bridge deposit carried by a proven request.
 *
 * The bridge enqueues one collection key per lock, so the code challenge is
 * `collectionKeys[0]` and the proven storage word is the running total locked.
 * `target` is returned so the caller can require the leaf originated from the
 * bridge rather than from another queue consumer.
 */
export function extractCodeChallengeAndTotalLocked(
    merkleTreeContractDepositAttestorInput: VerifiedRequestWitnessInput
) {
    // Unpack deposit
    const deposit = merkleTreeContractDepositAttestorInput.value;

    // Convert the code challenge from Bytes32 into a Field
    const codeChallengeBytes = deposit.collectionKeys[0].bytes;
    let codeChallenge = new Field(0);
    for (let i = 0; i < 32; i++) {
        codeChallenge = codeChallenge.mul(256).add(codeChallengeBytes[i].value);
    }

    Provable.asProver(() => {
        logger.log('deposit value bytes');
        logger.log(deposit.value.bytes.map((byte) => byte.toBigInt().toString()));
        logger.log('codeChallenge');
        logger.log(codeChallenge.toBigInt());
    });

    // Turn totalLocked into a field
    const totalLockedBytes = deposit.value.bytes;
    let totalLocked = new Field(0);
    for (let i = 0; i < 32; i++) {
        totalLocked = totalLocked.mul(256).add(totalLockedBytes[i].value);
    }

    return {
        totalLocked,
        codeChallenge,
        target: new Bytes20(deposit.target.bytes).toField(),
    };
}

export function buildContractDepositSlotLeaves(
    verifiedRequests: VerifiedRequest[]
): Field[] {
    return verifiedRequests.map((leaf) => provableRequestLeafHash(leaf));
}

export function getMerklePathFromContractDeposits(
    merkleLeaves: Field[],
    index: number
) {
    const nLeaves = merkleLeaves.length;
    const { depth, paddedSize } = computeMerkleTreeDepthAndSize(nLeaves);
    const path = getMerklePathFromLeaves(
        merkleLeaves,
        paddedSize,
        depth,
        index,
        getMerkleZeros(depth)
    );
    const merklePath = MerklePath.from([]);
    path.forEach((element) => merklePath.push(element));
    return merklePath;
}

async function proofConversionServiceRequest(
    depositBlockNumber: number,
    domain = 'https://pcs.nori.it.com'
): Promise<Sp1ProofAndConvertedProofBundle> {
    const fetchResponse = await fetch(
        `${domain}/converted-consensus-mpt-proofs/${depositBlockNumber}`
    );
    logger.log('fetchResponse GET', fetchResponse);
    const json = await fetchResponse.json();
    logger.log('parsedjson', json, typeof json);
    if ('error' in json) throw new Error(json.error as string);
    return json;
}

async function fetchContractWindowSlotProofs(
    depositBlockNumber: number,
    domain = 'https://pcs.nori.it.com'
) {
    logger.log(
        `Fetching proof bundle for deposit with block number: ${depositBlockNumber}`
    );

    const proofConversionTimer = createTimer();
    const {
        consensusMPTProof: {
            proof: consensusMPTProofProof,
            verified_requests: consensusMPTProofContractStorageSlots,
        },
        consensusMPTProofVerification: consensusMPTProofVerification,
    } = await proofConversionServiceRequest(depositBlockNumber, domain);
    logger.log(`proofConversionServiceRequest: ${proofConversionTimer()}`);

    logger.log(
        'consensusMPTProofVerification, consensusMPTProofProof, consensusMPTProofContractStorageSlots',
        consensusMPTProofVerification,
        consensusMPTProofProof,
        consensusMPTProofContractStorageSlots
    );

    return {
        consensusMPTProofProof,
        consensusMPTProofContractStorageSlots,
        consensusMPTProofVerification,
    };
}

export async function computeDepositAttestationWitness(
    depositBlockNumber: number,
    codeChallengeBEHex: string,
    ethTokenBridgeAddressHex: string,
    domain = 'https://pcs.nori.it.com'
) {
    const { consensusMPTProofContractStorageSlots } =
        await fetchContractWindowSlotProofs(depositBlockNumber, domain);

    // Find deposit
    logger.log(
        `Finding deposit within bundle.consensusMPTProof.contract_storage_slots`
    );
    const paddedVerifiedRequests: VerifiedRequestJson[] = (
        consensusMPTProofContractStorageSlots
    ).map((request) => {
        return {
            //prettier-ignore
            target: `0x${request.target.slice(2).padStart(40, '0').toLowerCase()}`,
            collectionKeysCount: request.collection_keys_count,
            //prettier-ignore
            collectionKeys: request.collection_keys.map(
                (key) => `0x${key.slice(2).padStart(64, '0')}`
            ),
            //prettier-ignore
            value: `0x${request.value.slice(2).padStart(64, '0')}`,
        };
    });
    // The queue is shared between consumers; only leaves the token bridge
    // enqueued carry this deposit's code challenge under its address.
    const bridgeTargetHex = `0x${ethTokenBridgeAddressHex
        .slice(2)
        .padStart(40, '0')
        .toLowerCase()}`;
    const depositIndex = paddedVerifiedRequests.findIndex(
        (request) =>
            request.target === bridgeTargetHex &&
            request.collectionKeys[0] === codeChallengeBEHex
    );
    if (depositIndex === -1)
        throw new Error(
            `Could not find deposit index with codeChallengeBEHex: ${codeChallengeBEHex} and target ${bridgeTargetHex} in requests ${JSON.stringify(
                paddedVerifiedRequests,
                null,
                4
            )}`
        );
    logger.log(
        `Found deposit within bundle.consensusMPTProof.contract_storage_slots`
    );
    const despositSlotRaw = paddedVerifiedRequests[depositIndex];
    const totalDespositedValue = despositSlotRaw.value;
    logger.log(`Total deposited to date (hex): ${totalDespositedValue}`);

    // Build deposit witness

    // Build leaves
    const buildLeavesTimer = createTimer();
    const leaves = buildContractDepositSlotLeaves(
        paddedVerifiedRequests.map(verifiedRequestFromJson)
    );
    logger.log(`buildContractDepositLeaves: ${buildLeavesTimer()}`);
    logger.log(
        'leaves',
        leaves.map((leaf) => leaf.toBigInt())
    );

    // Compute path
    const merklePathTimer = createTimer();
    const nLeaves = leaves.length;
    const { depth, paddedSize } = computeMerkleTreeDepthAndSize(nLeaves);
    const path = getMerklePathFromLeaves(
        [...leaves],
        paddedSize,
        depth,
        depositIndex,
        getMerkleZeros(depth)
    );
    logger.log(`getContractDepositWitness: ${merklePathTimer()}`);
    logger.log(
        'path',
        path.map((pathEle) => pathEle.toBigInt())
    );

    logger.log(`All inputs built needed to compute mint proof!`);

    return {
        path: path.map((it) => it.toBigInt().toString()),
        depositIndex,
        despositSlotRaw,
    };
}
