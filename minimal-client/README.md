# Minimal Client

This workspace is a demonstration of the end-to-end minting process on devnet within a browser, in the simplest possible manner.

WARNING: Real clients should NOT follow this as an example. This demo bakes sensitive .env credentials directly into bundled JS files.
In production, clients should instead integrate with real wallets such as MetaMask and Auro.

This setup exists only to:
- Facilitate debugging of workers.
- Provide an e2e test for CI.
- Demonstrate overall flow within the browser.
- Provide a browser-based clone of the e2e.devnet.spec.ts test located in `<repo root directory>/contracts/mina/src`.

------------------------------------------------------------

## Setup:

1. Install dependencies (within the root directory of the repository):
   `cd .. && npm install`

2. Configure your .env file:
   - ETH_PRIVATE_KEY=private key from which you wish to lock ETH to claim nETH
   - ETH_RPC_URL=https://ethereum-holesky.core.chainstack.com/<apiKey>
   - MINA_SENDER_PRIVATE_KEY=private key of the Mina address for which you wish to claim nETH
   - TEST_MINA_STAGING_CHAIN_NAME=mina (selects staging config from `env.ts` in `contracts/mina`, defaults to `mina`)

   Contract addresses, RPC URLs, and service endpoints are resolved automatically from the staging config in `contracts/mina/src/env.ts` via `getStagingEnv()`. The browser test builder bakes these into the bundle at build time.

## Testing:

Run the headless test:

`npm run test:e2e`

Run the tests by launching a browser (note needs Chrome, Chromium or Brave installed - Linux or Mac supported):

`npm run test:e2e:browser`