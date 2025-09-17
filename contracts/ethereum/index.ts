import noriTokenBridgeRaw from './artifacts/contracts/NoriTokenBridge.sol/NoriTokenBridge.json' with { type: "json" };

export interface Artifact {
  _format: string;
  contractName: string;
  sourceName: string;
  abi: Array<{
    inputs: Array<{
      internalType: string;
      name: string;
      type: string;
      indexed?: boolean;
    }>;
    name?: string;
    outputs?: Array<{
      internalType: string;
      name: string;
      type: string;
    }>;
    stateMutability?: string;
    type: string;
    anonymous?: boolean;
  }>;
  bytecode: string;
  deployedBytecode: string;
  linkReferences: Record<string, any>;
  deployedLinkReferences: Record<string, any>;
}

export const noriTokenBridgeJson: Artifact = noriTokenBridgeRaw as Artifact;

export * from './types/ethers-contracts/index.js';