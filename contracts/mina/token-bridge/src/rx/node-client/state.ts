export enum NodeJsClientState {
    Initialising = 'Initialising',
    Initialised = 'Initialised',
    InitialisationFailed = 'InitialisationFailed',

    LockingTokens = 'LockingTokens',
    LockedTokens = 'LockedTokens',
    LockingTokensFailed = 'LockingTokensFailed',

    WaitingForEthFinality = 'WaitingForEthFinality',

    WaitingForCurrentJobCompletion = 'WaitingForCurrentJobCompletion',
    WaitingForPreviousJobCompletion = 'WaitingForPreviousJobCompletion',
    MissedMintingOpportunity = 'MissedMintingOpportunity',

    CanMint = 'CanMint',
    Minting = 'Minting',
    MintingFailed = 'MintingFailed',
    Minted = 'Minted',
}

