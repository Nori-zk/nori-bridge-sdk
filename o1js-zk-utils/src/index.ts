export { computeMerkleTreeDepthAndSize, getMerkleZeros } from './merkle-attestor/merkleTree.js';

export { merkleLeafAttestorGenerator } from './merkle-attestor/merkleLeafAttestor.js';

export {
    buildMerkleTree,
    computeMerkleRootFromPath,
    foldMerkleLeft,
    getMerklePathFromLeaves,
    getMerklePathFromTree,
} from './merkle-attestor/merkleTree.js';

export {
    fieldToHexBE,
    fieldToHexLE,
    fieldToBigIntBE,
    fieldToBigIntLE,
    uint8ArrayToBigIntBE,
    decodeConsensusMptProof,
    compileAndVerifyContracts,
} from './utils.js';

export { ethVerifierVkHash } from './integrity/EthVerifier.VKHash.js';

export { EthVerifier, EthProof, EthInput } from './ethVerifier.js';

export * from './types.js';

export {
    ContractDepositAttestorInput,
    ContractDepositAttestor,
    ContractDepositAttestorProof,
    buildContractDepositLeaves,
    getContractDepositWitness,
    ContractDeposit,
} from './contractDepositAttestor.js';

export * from './nodeProofLeft.patch.js';