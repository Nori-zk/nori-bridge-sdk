export type WalletButtonTypes = "Mina" | "Ethereum";

export type ProgressStep =
  | "create_credential"
  | "store_credential"
  | "lock_tokens"
  | "get_locked_tokens";

export interface ProgressState {
  currentStep: ProgressStep;
  completedSteps: ProgressStep[];
}

export type ProgressAction =
  | { type: "NEXT_STEP"; payload: { nextStep: ProgressStep } }
  | { type: "RESET" };
