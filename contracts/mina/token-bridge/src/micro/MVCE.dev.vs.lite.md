# Start litenet
1. `npm install -g zkapp-cli`
2. `zk lightnet start`

# Build all workspaces and cd to token-contract
```sh
npm run build && cd contracts/mina/token-bridge
```

# Two ways to test

## Option 1 (use an existing deposit, simple and RECOMMENDED, to see the bug in the easiest way possible and in the least time)

`e2e.devnet.without-infra.spec.ts` and `e2e.litenet.without-infra.spec.ts` have been setup to allow one to attempt to mint using an existing deposit, thus no config is required and no deposit processing waiting is required (which would take ~35 mins). A throw away testnet mina private key has been baked into the devnet test spec file.

You can simply run these commands

### To test on Litenet
1. `cd <nori-bridge-sdk-root-dir>/contracts/mina/token-bridge`
2. Clear your o1js cache `rm ~/.cache/o1js/*` (on Linux may differ if using another OS)
3. `npm run test -- src/micro/e2e.litenet.without-infra.spec.ts`

### To test on Devnet
1. `cd <nori-bridge-sdk-root-dir>/contracts/mina/token-bridge`
2. Clear your o1js cache `rm ~/.cache/o1js/*` (on Linux may differ if using another OS)
3. `npm run test -- src/micro/e2e.devnet.without-infra.spec.ts`

The observed behaviour is that the litenet test passes and the devnet test fails with the following error:
```
Error: Transaction failed with errors:
    - {"statusCode":200,"statusText":"Couldn't send zkApp command: Stale verification key detected. Please make sure that deployed verification key reflects latest zkApp changes."}
```

Which occurs when invoking `zkAppWorker.WALLET_MOCK_signAndSendMintProofCache();` method. 

This is interesting because the vks of the smart contracts / zk programs between the deployed contract and the zk workers match. You can verify this yourself by looking for logs like this `console.log(`${name} contract/program vk hash compiled: '${hashStr}'`);` and confirm they match. Moreover looking at `https://minascan.io/` it can be confirmed that the vk's of the FungibleToken and TokenController contracts match what both the compiled contracts match within all the workers.

Looking in the source code I can see this error is stored as a default error replacement:

```
const defaultErrorReplacementRules: ErrorReplacementRule[] = [
  {
    pattern: /\(invalid \(Invalid_proof \\"In progress\\"\)\)/g,
    replacement:
      'Stale verification key detected. Please make sure that deployed verification key reflects latest zkApp changes.',
  },
];
```

So perhaps it is a misleading error used when the underlying error is not fully understood by o1js, this is a guess.

I have seen two different verification keys for the EthVerifier zk program amongst depending on the state of the cache ~/.cache/o1js/, the compiled vk's for EthVerifier do seem to depend on what other ZK programs have been previously compiled, this is very hard to reproduce reliably, I will continue trying. 

We have had constant problems with the reliability of building zk programs with consistent vks for some of our programs and we have a defensive solution for this, we 'bake' verification key hash strings into the repository itself for EthVerifier they can be seen here `<nori-bridge-sdk root directory>/o1js-zk-utils/src/integrity/EthVerifier.VkHash.json` which is generated when running `npm run bake-vk-hashes` which creates an cache emphemeral directory and compiles EthVerifier in this fresh directory and then stores the VK's hash into the json file. Later when running programs which rely on this zk program we compile using the default o1js cache dir and then compare the compiled vk hash against the stored hash, thus ensuring that we validate our compile zk program and ensure it can be reliably reproduced from a cold cache or from a browser (which effectively always has a cold cache).

## Option 2 Make real deposit (relies on nori infrastructure to process a deposit and each one will take a mean time of 35 minutes to get to the minting stage, NOT RECOMMENDED)

# Configure pre deploy

There are some credentials here: https://github.com/Nori-zk/nori-minimal-client/tree/skip-creds

Configure a .env file in `contracts/mina/token-bridge`

```
MINA_RPC_NETWORK_URL=https://devnet.minaprotocol.network/graphql
SENDER_PRIVATE_KEY=<sender mina private key found in the repository above 'skip-creds' branch>
TX_FEE=0.1
```

# Deploy 'micro' [if not running on linux rm your cache directory as required]
```sh
rm ~/.cache/o1js/* && npm run deploy-micro > fresh.deploy.micro 2>&1
```

# Configure post deploy

Copy env vars to .env within contracts/mina/token-bridge/.env (rename NORI_TOKEN_CONTROLLER_ADDRESS as NORI_CONTROLLER_PUBLIC_KEY, and rename TOKEN_BASE_ADDRESS as NORI_TOKEN_PUBLIC_KEY)

Setup the other .env vars you will need

- ETH_PRIVATE_KEY (A funded holesky eth private key)
- ETH_RPC_URL (Something like `https://ethereum-holesky.core.chainstack.com/.....`)
- `NORI_TOKEN_BRIDGE_ADDRESS=0x3EEACD9caa1aDdBA939FF041C43020b516A51dcF`
- `MINA_RPC_NETWORK_URL=https://devnet.minaprotocol.network/graphql`
- SENDER_PRIVATE_KEY (A funded mina devnet private key)

# 

# Run both litenet and devnet tests and make a real deposit. (takes about an hour) [if not running on linux rm your cache directory as required]

```sh
rm ~/.cache/o1js/* && npm run test -- src/micro/e2e.litenet.spec.ts > fresh.test.micro.e2e.litenet.spec 2>&1 && rm ~/.cache/o1js/* && npm run test -- src/micro/e2e.devnet.spec.ts > fresh.test.micro.e2e.devnet.spec 2>&1
```

# How to analyse

Check all vk prints 

You will see prints like:

console.timeEnd(`${name} compiled`); // with times and program names
and console.log(`${name} contract/program vk hash compiled: '${hashStr}'`); // including the hash field (converted into a string) of the vk

Litenet will pass... devnet with fail. Both will show the same vk's. Devnet will fail with error relating
to a stale verification key (which might be the default error).

If you dont clear your cache you may see this `${name}: Computed hash '${hashStr}' doesn't match expected hash '${integrityHash}'` which happens depending on the state of the cache at any given time. This is hard to generate an MVCE for but I am trying! It may be possible to see this with litenet and devnet in the non 'micro' build aka ../ from this folder.