# Mina zkApp: Token Bridge

A Mina zk-program contract allowing users to mint tokens on Nori Bridge.

## How to build

In the repositories root directory run:

```sh
npm run build
```

## Usage

### Import workers

You have several options depending on your environment and bundler setup:

---

#### 1. **Use Node.js workers directly**  
> Only valid in a Node.js environment (e.g., backend services, CLI tools)

```typescript
import { getTokenMintWorker } from '@nori-zk/mina-token-bridge/node/workers/tokenMint';
import { getCredentialAttestationWorker } from '@nori-zk/mina-token-bridge/node/workers/credentialAttestation';
```

---

#### 2. **Use browser workers directly**  
> Only works if your bundler supports importing workers directly (e.g., Vite, Webpack 5+ with proper config)

```typescript
import { getTokenMintWorker } from '@nori-zk/mina-token-bridge/browser/workers/tokenMint';
import { getCredentialAttestationWorker } from '@nori-zk/mina-token-bridge/browser/workers/credentialAttestation';
```

---

#### 3. **Import pure logic worker classes and lift them into workers manually**  
> Use this if you're building your own worker pipeline (custom setup, unsupported bundler, etc.)

```typescript
import {
  CredentialAttestationWorker,
  TokenMintWorker,
} from '@nori-zk/mina-token-bridge/pure-workers';
```

- You must lift these pure classes into actual workers.  
- You can use either:
  
  - **(a) Provided worker tooling**

    > Uses `WorkerParent`, `WorkerChild`, and `createParent/createWorker` from the mina-token-bridge repo

    ```typescript
    //workers/credentialAttestation/browser/parent.ts
    import { CredentialAttestationWorker } from '@nori-zk/mina-token-bridge/pure-workers';
    import { WorkerParent } from '@nori-zk/mina-token-bridge/browser/worker/parent';
    import { createParent } from '@nori-zk/mina-token-bridge/worker';

    const workerUrl = new URL('./child.js', import.meta.url);
    export const getCredentialAttestationWorker = () =>
      createParent(new WorkerParent(workerUrl), CredentialAttestationWorker);
    ```

    ```typescript
    //workers/credentialAttestation/browser/child.ts
    import { CredentialAttestationWorker } from '@nori-zk/mina-token-bridge/pure-workers';
    import { WorkerChild } from '@nori-zk/mina-token-bridge/browser/worker/child';
    import { createWorker } from '@nori-zk/mina-token-bridge/worker';

    export const credentialAttestationWorker = createWorker(
      new WorkerChild(),
      CredentialAttestationWorker
    );
    ```

  ---

  - **(b) Your own tooling (e.g., using Comlink)**

    > This example shows how to wire up a pure worker using [Comlink](https://github.com/GoogleChromeLabs/comlink)

    ```typescript
    //workers/credentialAttestation/child.ts
    import * as Comlink from 'comlink';
    import { CredentialAttestationWorker } from '@nori-zk/mina-token-bridge/pure-workers';

    Comlink.expose(new CredentialAttestationWorker());
    ```

    ```typescript
    //workers/credentialAttestation/parent.ts
    import * as Comlink from 'comlink';
    import type { CredentialAttestationWorker } from '@nori-zk/mina-token-bridge/pure-workers';

    const worker = new Worker(new URL('./child.ts', import.meta.url), { type: 'module' });

    type CredentialAttestationWorkerInstance = InstanceType<typeof CredentialAttestationWorker>;

    const workerApi = Comlink.wrap<CredentialAttestationWorkerInstance>(worker);

    export const getCredentialAttestationWorker = () => workerApi;
    ```

---

### Main imports

```typescript
import { TransitionNoticeMessageType } from '@nori-zk/pts-types';
import { getReconnectingBridgeSocket$ } from '@nori-zk/mina-token-bridge/rx/socket';
import {
  getBridgeStateTopic$,
  getBridgeTimingsTopic$,
  getEthStateTopic$,
} from '@nori-zk/mina-token-bridge/rx/topics';
import {
  BridgeDepositProcessingStatus,
  getDepositProcessingStatus$,
  bridgeStatusesKnownEnoughToLockUnsafe,
  bridgeStatusesKnownEnoughToLockSafe,
  canMint,
  getDepositProcessingStatus$,
  readyToComputeMintProof,
} from '@nori-zk/mina-token-bridge/rx/deposit';
import { FungibleToken, NoriStorageInterface, NoriTokenController, signSecretWithEthWallet } from '@nori-zk/mina-token-bridge';

// Import your worker getter function here to support minting, e.g.:
// import { getCredentialAttestationWorker } from './workers/credentialAttestation/parent';

// Do other logic such as retrieving user balance etc.
```

### Example of mint flow

See the [E2E test](src/e2e.workers3.spec.ts) for a comprehensive example.

### Example of token contracts usage

#### Get user balance

```typescript
const tokenBase = new FungibleToken(tokenAddress);

await fetchAccount({
  publicKey: userPublicKey,
  tokenId: tokenBase.deriveTokenId(),
});

const balance = await tokenBase.getBalanceOf(userPublicKey);
```

#### Get user storage info

```typescript
const noriTokenController = new NoriTokenController(noriAddress);

const storage = new NoriStorageInterface(
    userPublicKey,
    noriTokenController.deriveTokenId()
);

await fetchAccount({
  publicKey: userPublicKey,
  tokenId: noriTokenController.deriveTokenId(),
});

const userKeyHash = await storage.userKeyHash.fetch();
const mintedSoFar = await storage.mintedSoFar.fetch();
```

## Token Contract Deployment

In order to deploy the contract, a script has been provided as an npm command:

```sh
npm run deploy
```

This command builds the project and runs the deployment script with Node.js using the necessary experimental flags for VM and WASM modules.

### Environment Variables

To configure the deployment, set the following environment variables:

- `MINA_RPC_NETWORK_URL`  
  The Mina network RPC endpoint URL.  
  Defaults to `http://localhost:8080/graphql` if unset.

- `SENDER_PRIVATE_KEY`  
  Private key of the deploying sender account.  
  Required for non-local deployments. Auto-generated for localhost.

- `NORI_CONTROLLER_PRIVATE_KEY`  
  Private key for the Nori Token Controller contract.  
  Randomly generated if not provided.

- `TOKEN_BASE_PRIVATE_KEY`  
  Private key for the Token Base contract.  
  Randomly generated if not provided.

- `ADMIN_PUBLIC_KEY`  
  Public key of the admin.  
  Defaults to the public key derived from `SENDER_PRIVATE_KEY`.

- `ETH_PROCESSOR_ADDRESS`  
  Optional Ethereum processor contract address.

- `TX_FEE`  
  Transaction fee to use. Defaults to `0.1`.

- `MOCK`  
  Optional flag to indicate mock mode ('true' or omit for false [the default]).

### Example `.env` file

```
MINA_RPC_NETWORK_URL=http://localhost:8080/graphql
SENDER_PRIVATE_KEY=your_sender_private_key_here
NORI_CONTROLLER_PRIVATE_KEY=your_nori_controller_key_here
TOKEN_BASE_PRIVATE_KEY=your_token_base_private_key_here
ADMIN_PUBLIC_KEY=your_admin_public_key_here
ETH_PROCESSOR_ADDRESS=optional_eth_processor_address
TX_FEE=0.1
MOCK=true
```

## How to run the tests

### Install Mina lightnet

1. `npm install -g zkapp-cli`
2. `zk lightnet start`

### Configure the .env file in the contracts/ethereum workspace

contracts/ethereum/.env
```
ETH_PRIVATE_KEY=<Your ETH private key>
ETH_RPC_URL=<Ethereum execution RPC e.g. 'https://ethereum-holesky.core.chainstack.com/<apiKey>'>
ETH_NETWORK=holesky (for example)
NORI_TOKEN_BRIDGE_TEST_MODE=true
NORI_TOKEN_BRIDGE_ADDRESS=<Extract this from contracts/ethereum/.env.nori-token-bridge, after running npm run deploy (within the contracts/ethereum workspace), or use an already deployed test contract>
```

### Then run the tests

```sh
npm run test # all tests (hangs due to multiple instances of o1js deps)
npm run test -- -t 'e2e_complete' # run a specific test (e.g. the litenet e2e test)
npm run test -- src/e2e.workers2.spec.ts # run a specific test file (e.g. the litenet e2e test)
npm run testw # watch mode
```

### How to run E2E test on DevNet

Firstly configure your `contracts/mina/token-bridge/.env` file:

```
ETH_PRIVATE_KEY=<Holesky ETH private key which will send the Holesky ETH>
ETH_RPC_URL=https://ethereum-holesky.core.chainstack.com/<apiKey>
NORI_TOKEN_BRIDGE_ADDRESS=<Holesky ETH Nori Token Bridge address>
NORI_CONTROLLER_PUBLIC_KEY=<Nori Mina TestNet Token controller base58 address>
MINA_RPC_NETWORK_URL=https://devnet.minaprotocol.network/graphql
SENDER_PRIVATE_KEY=<Nori Mina TestNet private key which will receive the deposit>
```

**Note a real Mina TestNet contract must already be deployed.** 

#### After configuration, run the E2E test procedure:

`npm run test -- src/e2e.workers3.spec.ts`

## How to run coverage

```sh
npm run coverage
```

## License

[Apache-2.0](LICENSE)
