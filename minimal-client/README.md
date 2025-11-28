# Minimal Client

This workspace is a demonstration of the end-to-end minting process on devnet within a browser, in the simplest possible manner.

WARNING: Real clients should NOT follow this as an example. This demo bakes sensitive .env credentials directly into bundled JS files.
In production, clients should instead integrate with real wallets such as MetaMask and Auro.

This setup exists only to:
- Facilitate debugging of workers.
- Provide an e2e test for CI.
- Demonstrate overall flow within the browser.
- Provide a browser-based clone of the e2e.devnet.spec.ts test located in `<repo root directory>/contracts/mina/token-bridge/src`.

------------------------------------------------------------

## Setup:

1. Install dependencies (within the root directory of the repository):
   `cd .. && npm install`

2. Configure your .env file:
   - ETH_PRIVATE_KEY=private key from which you wish to lock ETH to claim nETH
   - ETH_RPC_URL=https://ethereum-holesky.core.chainstack.com/<apiKey>
   - NORI_TOKEN_BRIDGE_ADDRESS=0x3EEACD9caa1aDdBA939FF041C43020b516A51dcF
   - NORI_TOKEN_CONTROLLER_ADDRESS=B62qnQmGKK48aUeM8DdDmA6kGNR1oD9cMg3DXs9RuyC4gvR2A3MKVJV
   - TOKEN_BASE_ADDRESS=B62qmkVtMBbCnSEzC14Ym5ekJGMXGru6qV4pT6HvXH3FKNomjop5Syc
   - MINA_RPC_NETWORK_URL=https://api.minascan.io/node/devnet/v1/graphql
   - PROOF_CONVERSION_SERVICE_URL=https://pcs.nori.it.com
   - SENDER_PRIVATE_KEY=private key of the Mina address for which you wish to claim nETH

## Testing:

Run the headless test:

`npm run test:e2e`

Run the tests by launching a browser (note needs Chrome, Chromium or Brave installed - Linux or Mac supported):

`npm run test:e2e:browser`