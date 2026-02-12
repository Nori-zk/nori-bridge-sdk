# Mina zkApp: Token Bridge

A Mina zk-program contract allowing users to mint tokens on Nori Bridge.

## How to build

In the repositories root directory run:

    npm run build

## Usage

### Import workers

You have two options depending on your environment:

---

#### 1. **Use Node.js workers directly**  
> Only valid in a Node.js environment (e.g., backend services, CLI tools)

Node.js Worker Usage:

```typescript
import { getZkAppWorker } from '@nori-zk/mina-token-bridge/node/workers/zkAppWorker';

async function main() {
    const ZkAppWorker = getZkAppWorker();
    const tokenMintWorker = new ZkAppWorker();
    // Optional as method calls are buffered
    await tokenMintWorker.ready;
    await tokenMintWorker.compileAll();
}
main();
```
---

#### 2. **For the browser, import pure logic worker class and lift it into a usable workers manually**  
> Use this if you're building your own worker pipeline in a front-end

```typescript
import {
    ZkAppWorker
} from '@nori-zk/mina-token-bridge/workers/defs';
```

You must lift this pure class into an actual worker. Example:

```typescript
// workers/zkAppWorker/browser/parent.ts
import { WorkerParent } from '@nori-zk/workers/browser/parent';
import { type ZkAppWorker as ZkAppWorkerType } from '@nori-zk/mina-token-bridge/workers/defs';
import { createProxy } from '@nori-zk/workers';

export function getZkAppWorker() {
    const worker = new Worker(new URL('./child.ts', import.meta.url), {
        type: 'module',
    });
    const workerParent = new WorkerParent(worker);
    return createProxy<typeof ZkAppWorkerType>(workerParent);
}
```

```typescript
// workers/zkAppWorker/browser/child.ts
import { ZkAppWorker } from '@nori-zk/mina-token-bridge/workers/defs';
import { WorkerChild } from '@nori-zk/workers/browser/child';
import { createWorker } from '@nori-zk/workers';

createWorker(
    new WorkerChild(),
    ZkAppWorker
);
```

Browser Worker Usage:

```typescript
import { getZkAppWorker } from './workers/zkAppWorker/browser/parent.ts';
async function main() {
    const ZkAppWorker = getZkAppWorker();
    const zkAppWorkerWorker = new ZkAppWorker();
    // Optional as method calls are buffered
    await zkAppWorkerWorker.ready;
    await zkAppWorkerWorker.compile();
    // Do other operations...
    // Cleanup the worker when you're finished with it...
    zkAppWorkerWorker.signalTerminate();
}

// run main etc
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
    getDepositProcessingStatus$,
    // Promise triggers resolve when key event occurs and reject after opportunity has been missed:
    canMint,
    readyToComputeMintProof,
    // Observable triggers:
    // CanMint observable:
    getCanMint$, // cycles through states of 'Waiting', 'ReadyToMint' and 'MissedMintingOpportunity'
    CanMintStatus,
    // CanComputeEthProof observable:
    getCanComputeEthProof$, // cycles through states of 'Waiting', 'CanCompute', or 'MissedMintingOpportunity'
    CanComputEthProof,
} from '@nori-zk/mina-token-bridge/rx/deposit';
import { FungibleToken, NoriStorageInterface, NoriTokenController, signSecretWithEthWallet, env } from '@nori-zk/mina-token-bridge';
// Import your worker getter function here to support minting, e.g.:
// import { getZkAppWorker } from './workers/zkAppWorker/browser/parent.ts'
// Do other logic such as retrieving user balance etc.
```

### Example of mint flow

See the [E2E test](src/e2e.devnet.spec.ts) for a comprehensive example.

## Bake integrity hashes

If the smart contracts have been updated please run `npm run bake-vk-hashes` to update the integrity files. All workers will validate these after contract/program compilation.

## How to deploy (launch new contracts)

Set up your `.env` file in the root directory. Set:

- `MINA_RPC_NETWORK_URL` - Mina network RPC endpoint URL
- `SENDER_PRIVATE_KEY` - Private key of the transaction sender
- `TX_FEE` - Transaction fee to be used when submitting transactions (optional, defaults to 0.1)
- `ADMIN_PUBLIC_KEY` - Public key of the admin account (optional, derived from SENDER_PRIVATE_KEY if not provided)
- `ETH_PROCESSOR_ADDRESS` - Address of the deployed EthProcessor contract (optional, will generate random if not provided)

Run:

    npm run deploy

This command will:
1. Generate new private keys for NoriTokenController and TokenBase if not already set
2. Deploy both contracts to the network
3. Write a `.env.nori-token-bridge` file containing:
   - `NORI_CONTROLLER_PRIVATE_KEY`
   - `NORI_TOKEN_CONTROLLER_ADDRESS`
   - `TOKEN_BASE_PRIVATE_KEY`
   - `TOKEN_BASE_ADDRESS`
   - `ADMIN_PUBLIC_KEY`
   - `TOKEN_BASE_TOKEN_ID`
   - `NORI_TOKEN_CONTROLLER_TOKEN_ID`

Copy these values into your `.env` file for future operations.

After deployment, update `src/env.ts` with the deployed addresses and token IDs:
- `NORI_TOKEN_CONTROLLER_ADDRESS`
- `TOKEN_BASE_ADDRESS`
- `TOKEN_BASE_TOKEN_ID`
- `NORI_TOKEN_CONTROLLER_TOKEN_ID`

### Example `.env` file for new deployment

    MINA_RPC_NETWORK_URL=http://localhost:8080/graphql
    SENDER_PRIVATE_KEY=your_sender_private_key_here
    TX_FEE=0.1
    ETH_PROCESSOR_ADDRESS=optional_eth_processor_address

## How to re-deploy (update verification keys on existing contracts)

The verification keys used in the deploy/re-deploy command are computed from the stored zk programs directly but validated against the integrity hashes before deployment is allowed.

Perform the following steps if contract verification keys have been updated due to changes in the smart contracts or their dependencies:

1. Run `npm run bake-vk-hashes` to update integrity hashes
2. Set up your `.env` file with the existing contract information:
   - `MINA_RPC_NETWORK_URL`
   - `SENDER_PRIVATE_KEY` - Must be the admin private key with permissions to update verification keys
   - `NORI_CONTROLLER_PRIVATE_KEY` - Existing controller private key
   - `TOKEN_BASE_PRIVATE_KEY` - Existing token base private key
   - `NORI_TOKEN_CONTROLLER_ADDRESS` - Deployed controller address
   - `TOKEN_BASE_ADDRESS` - Deployed token base address
   - `TX_FEE` (optional)
3. Run `npm run deploy`

The script will detect that contract keys already exist and perform a verification key update instead of deploying new contracts.

Note: The contract addresses and token IDs remain unchanged during VK updates, but the script will output them for verification.

### Example `.env` file for VK update

    MINA_RPC_NETWORK_URL=http://localhost:8080/graphql
    SENDER_PRIVATE_KEY=admin_private_key_here
    NORI_CONTROLLER_PRIVATE_KEY=existing_controller_key_here
    TOKEN_BASE_PRIVATE_KEY=existing_token_base_key_here
    NORI_TOKEN_CONTROLLER_ADDRESS=existing_controller_address
    TOKEN_BASE_ADDRESS=existing_token_base_address
    TX_FEE=0.1

## How to run the tests

1. `npm install -g zkapp-cli`
2. `zk lightnet start -p full -t real -l Debug`

### Configure the .env file in the contracts/ethereum workspace

    ETH_PRIVATE_KEY=<Your ETH private key>
    ETH_RPC_URL=<Ethereum execution RPC e.g. 'https://ethereum-holesky.core.chainstack.com/<apiKey>'>
    ETH_NETWORK=holesky
    NORI_TOKEN_BRIDGE_TEST_MODE=true
    NORI_TOKEN_BRIDGE_ADDRESS=<Extract this from contracts/ethereum/.env.nori-token-bridge>

### Then run the tests

    npm run test
    npm run test -- -t 'e2e_complete'
    npm run test -- src/e2e.litenet.spec.ts
    npm run testw

### How to run E2E test on LiteNet

    npm run test -- src/e2e.litenet.spec.ts

### How to run E2E test on DevNet

Configure your contracts/mina/token-bridge/.env file:

    ETH_PRIVATE_KEY=<Holesky ETH private key>
    ETH_RPC_URL=https://ethereum-holesky.core.chainstack.com/<apiKey>
    NORI_TOKEN_BRIDGE_ADDRESS=<Holesky ETH Nori Token Bridge address>
    NORI_TOKEN_CONTROLLER_ADDRESS=<Nori Mina TestNet Token controller base58 address>
    MINA_RPC_NETWORK_URL=https://devnet.minaprotocol.network/graphql
    SENDER_PRIVATE_KEY=<Nori Mina TestNet private key>
    TOKEN_BASE_ADDRESS=<Nori Mina TestNet Token base base58 address>

Run the E2E test procedure with a deployed devnet contract:

    npm run test -- src/e2e.devnet.spec.ts

## How to run coverage

    npm run coverage

## License

[Apache-2.0](LICENSE)
