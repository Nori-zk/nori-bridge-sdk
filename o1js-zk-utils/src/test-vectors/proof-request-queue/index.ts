import requestLeafVectorsRaw from './request-leaf-vectors.json' with { type: 'json' };
import proofOutputsVectorsRaw from './proof-outputs-vectors.json' with { type: 'json' };
import entryLocationVectorsRaw from './entry-location-vectors.json' with { type: 'json' };

/** One queue request and the Poseidon leaf the SP1 guest hashes it to. */
export type RequestLeafVector = {
    name: string;
    /** 20-byte consumer contract address, `0x`-prefixed big-endian. */
    target: string;
    collectionKeysCount: number;
    /** Exactly two 32-byte keys; entries past `collectionKeysCount` are zero. */
    collectionKeys: [string, string];
    /** 32-byte storage word, `0x`-prefixed big-endian. */
    value: string;
    /** Poseidon field element, decimal. */
    leaf: string;
};

/** A `ProofOutputs` struct and its 220-byte public-values encoding. */
export type ProofOutputsVector = {
    name: string;
    inputSlot: string;
    inputStoreHash: string;
    outputSlot: string;
    outputStoreHash: string;
    executionStateRoot: string;
    verifiedContractDepositsRoot: string;
    nextSyncCommitteeHash: string;
    proofRequestQueueAddress: string;
    inputQueueCursor: string;
    outputQueueCursor: string;
    outputBlockNumber: string;
    /** `0x`-prefixed, 220 bytes. */
    bytes: string;
};

/** One storage word of a queue entry, and the slot the guest derives for it. */
export type EntryLocationWord = {
    /** Field name on `NoriProofRequestQueue.Request`. */
    name: string;
    wordIndex: number;
    /** 32-byte storage key, `0x`-prefixed. */
    slot: string;
};

/** Storage locations of one queue entry's five words. */
export type EntryLocationVector = {
    /** Queue index, decimal. */
    index: string;
    /** `keccak256(abi.encode(index, requestsMappingSlotIndex))`. */
    base: string;
    words: EntryLocationWord[];
};

/**
 * Queue storage layout: the `head` slot and, per entry index, the five
 * consecutive keys its words live at. Solidity must place `_requests[index]`
 * at exactly these slots.
 */
export type EntryLocationVectors = {
    headSlot: string;
    requestsMappingSlotIndex: number;
    entryWords: number;
    entries: EntryLocationVector[];
};

const requestLeafVectors = requestLeafVectorsRaw as RequestLeafVector[];
const proofOutputsVectors = proofOutputsVectorsRaw as ProofOutputsVector[];
const entryLocationVectors = entryLocationVectorsRaw as EntryLocationVectors;

export { requestLeafVectors, proofOutputsVectors, entryLocationVectors };
