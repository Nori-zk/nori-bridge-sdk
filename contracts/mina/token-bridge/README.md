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
import { getDepositAttestationWorker } from '@nori-zk/mina-token-bridge/node/workers/depositAttestation';
import { getCredentialAttestationWorker } from '@nori-zk/mina-token-bridge/node/workers/credentialAttestation';
```

---

#### 2. **Use browser workers directly**  
> Only works if your bundler supports importing workers directly (e.g., Vite, Webpack 5+ with proper config)

```typescript
import { getTokenMintWorker } from '@nori-zk/mina-token-bridge/browser/workers/tokenMint';
import { getDepositAttestationWorker } from '@nori-zk/mina-token-bridge/browser/workers/depositAttestation';
import { getCredentialAttestationWorker } from '@nori-zk/mina-token-bridge/browser/workers/credentialAttestation';
```

---

#### 3. **Import pure logic worker classes and lift them into workers manually**  
> Use this if you're building your own worker pipeline (custom setup, unsupported bundler, etc.)

```typescript
import {
  CredentialAttestationWorker,
  DepositAttestationWorker,
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
    workers/credentialAttestation/child.ts
    import * as Comlink from 'comlink';
    import { CredentialAttestationWorker } from '@nori-zk/mina-token-bridge/pure-workers';

    Comlink.expose(new CredentialAttestationWorker());
    ```

    ```typescript
    workers/credentialAttestation/parent.ts
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
} from '@nori-zk/mina-token-bridge/rx/deposit';

import { signSecretWithEthWallet } from '@nori-zk/mina-token-bridge';

// Import your worker getter function here, e.g.:
// import { getCredentialAttestationWorker } from './workers/credentialAttestation/parent';
```

### Example

See the [E2E test](src/e2e.workers2.spec.ts) for a comprehensive example.

## How to run tests

Install Mina lightnet

1. `npm install -g zkapp-cli`
2. `zk lightnet start`

```sh
npm run test # all tests (hangs due to multiple instances of o1js deps)
npm run test -- -t 'e2e_complete' # run a specific test (e.g. the complete e2e test)
npm run test -- src/e2e.workers2.spec.ts # run a specific test file
npm run testw # watch mode
```

## How to run coverage

```sh
npm run coverage
```

## License

[Apache-2.0](LICENSE)
