# Minimal Client

This workspace is a demonstration of the end-to-end minting process on devnet within a browser, in the simplest possible manner.

WARNING: Real clients should NOT follow this as an example. This demo bakes sensitive .env credentials directly into bundled JS files.
In production, clients should instead integrate with real wallets such as MetaMask and Auro.

This setup exists only to:
- Facilitate debugging of workers.
- Demonstrate overall flow within the browser.
- Provide a browser-based clone of the e2e.devnet.spec.ts test located in `<repo root directory>/contracts/mina/token-bridge/src`.

------------------------------------------------------------

USAGE

1. Install dependencies:
   npm install

2. Configure your .env file:
   - ETH_PRIVATE_KEY=private key from which you wish to lock ETH to claim nETH
   - ETH_RPC_URL=https://ethereum-holesky.core.chainstack.com/<apiKey>
   - NORI_TOKEN_BRIDGE_ADDRESS=0x3EEACD9caa1aDdBA939FF041C43020b516A51dcF
   - NORI_TOKEN_CONTROLLER_ADDRESS=B62qjgjGUXwYt4TLnAFu6cfcYGas3NzBP3P9ZNsaL14CKF2uM9GrZFi
   - TOKEN_BASE_ADDRESS=B62qmvTd6LRDRRRQk3TLBsw376UsVrr9wYfRwbNhfkYYwSyJFVTcZ4X
   - MINA_RPC_NETWORK_URL=https://devnet.minaprotocol.network/graphql
   - SENDER_PRIVATE_KEY=private key of the Mina address for which you wish to claim nETH

3. Bake the credentials into the bundle:
   `npm run build`

4. Start the webserver:
   `npm run serve`

   This will:
   - Serve the test HTML file from the public directory.
   - Create a localhost proxy for:
     - The Nori proof service
     - The devnet.minaprotocol.network/graphql endpoint.

5. Visit the webpage emitted in stdout from the serve command.
   - Open browser DevTools console to monitor progress of the lock + mint operation.
   - Process can take ~35 minutes.
