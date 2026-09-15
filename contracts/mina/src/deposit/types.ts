import { BridgeDepositProcessingStatus } from '../rx/deposit.js';

export enum DepositStateExtension {
    Undetermined = 'undetermined',
    Unprocessed = 'unprocessed',
}

export type DepositProcessingTerminalState =
    | BridgeDepositProcessingStatus.ReadyToMint
    | BridgeDepositProcessingStatus.MissedMintingOpportunity;

export type DepositState = DepositStateExtension | DepositProcessingTerminalState;

export const DepositState = {
    Undetermined: DepositStateExtension.Undetermined,
    Unprocessed: DepositStateExtension.Unprocessed,
    ReadyToMint: 'readyToMint',
    MissedMintingOpportunity: 'missedMintingOpportunity',
} as const;
