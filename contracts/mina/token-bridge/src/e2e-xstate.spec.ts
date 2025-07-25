enum MintState {
  Initialising = "initialising",

  LockingTokens = "lockingTokens",
  LockingTokensFailed = "lockingTokensFailed",

  WaitingForEthFinality = "waitingForEthFinality",

  WaitingForCurrentJobCompletion = "waitingForCurrentJobCompletion",
  WaitingForPreviousJobCompletion = "waitingForPreviousJobCompletion",
  MissedMintingOppertunity = "missedMintingOppertunity",

  CanMint = "canMint",
  Minting = "minting",
  MintingFailed = "mintingFailed",
  Minted = "minted"
}


// KeyTransitionStageMessageTypes are the bridge head states

/*
Are the websocket observables

let bridgeStageTimings: KeyTransitionStageEstimatedTransitionTime;
let bridgeState: BridgeLastStageState;
let ethState: BridgeEthFinalizationStatus;
*/