# Start litenet
1. `npm install -g zkapp-cli`
2. `zk lightnet start`

# Build all workspaces and cd to token-contract
```sh
npm install && npm run build && cd contracts/mina/token-bridge
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

### Speculations as to the behaviour.

This is interesting because the vks of the smart contracts / zk programs between the deployed contract and the zk workers match. You can verify this yourself by looking for logs like this `console.log(${name} contract/program vk hash compiled: '${hashStr}');` and confirm they match. Moreover looking at `https://minascan.io/` it can be confirmed that the vk's of the FungibleToken and TokenController contracts match what both the compiled contracts match within all the workers.

Also interesting that `zkAppWorker.MOCK_setupStorage` method can and does work, and thus perhaps we may conclude that NoriTokenController is not the cause.

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

So perhaps it is a misleading error used when the underlying error is not fully understood by o1js, this is a guess. I personally([@jk89](https://github.com/jk89)) suspect the error relates to EthVerifier.

I have seen two different verification keys for the EthVerifier zk program amongst depending on the state of the cache ~/.cache/o1js/, the compiled vk's for EthVerifier do seem to depend on what other ZK programs have been previously compiled, this is somewhat tricky to reproduce but does occur....

We have had constant problems with the reliability of building zk programs with consistent vks for some of our programs and we have a defensive solution for this, we 'bake' verification key hash strings into the repository itself for EthVerifier they can be seen here `<nori-bridge-sdk root directory>/o1js-zk-utils/src/integrity/EthVerifier.VkHash.json` which is generated when running `cd <nori-bridge-sdk root directory>/o1js-zk-utils && npm run bake-vk-hashes` which creates an cache emphemeral directory and compiles EthVerifier in this fresh directory and then stores the VK's hash into the json file. Later when running programs which rely on this zk program we compile using the default o1js cache dir and then compare the compiled vk hash against the stored hash, thus ensuring that we validate our compile zk program and ensure it can be reliably reproduced from a cold cache or from a browser (which effectively always has a cold cache for zk programs [not nessesarily for contracts which may have a bespoke cache strategy]).

When running `cd <nori-bridge-sdk root directory>/o1js-zk-utils && npm run bake-vk-hashes` or one of the tests located in `cd <nori-bridge-sdk-root-dir>/contracts/mina/token-bridge` running `rm ~/.cache/o1js/* && npm run test -- src/micro/e2e.litenet.without-infra.spec.ts` or `rm ~/.cache/o1js/* && npm run test -- src/micro/e2e.devnet.without-infra.spec.ts` we obtain the following vk hash for EthVerifier `18898419980749081858185627310467310990096965437609867313373155526674043887824`. And with this vk the e2e.devnet style tests within the `micro` folder do not succeed, while the litenet test does work (I presume there is less validation in lightnet). 

Moreover it is important to note we have another smart contract which depends on EthVerifier namely EthProcessor which runs on our infrastructure and it computes (when its container starts with an empty o1js cache) via a single worker the vk hash to be `18898419980749081858185627310467310990096965437609867313373155526674043887824`. It also uses verifies the vk hash matches the stored hash before it allows a fleet of workers to compile (in parallel) using the common cache and they too come up with the same hash. This particular procedure due to use having problems with the cache. Prior to us blocking the instantiation of the worker process pool while a single worker compiles and populates the common cache, we allowed all workers to compile simulatiously using the common cache and in this case we could come up with a different vk ending in 65. We assumed this was due to some sort of contention and subsequent corruption and put in a mitigation strategy previously describe which has led us to more consistent behaviour.

Alternatively:

When running `cd <nori-bridge-sdk root directory>/contracts/mina/token-bridge && npm run test -- src/e2e.prerequisites.spec.ts` which compiles a bunch of other zk programs before compiling EthVerifier (and it does in a single thread/process with no parallel workers) we can obtain another vk hash `15353094949572328638942911616600739835832014383382457564237536370555232424065`. I believe that our successful e2e tests previously have had this vk hash (note the previous e2e test which worker were within the `<nori-bridge-sdk root directory>/contracts/mina/token-bridge` and `<nori-bridge-sdk root directory>/contracts/mina/token-bridge/slim` directories) and not the vk hash ending in 24! We have not managed to get a succesful test in devnet when the vk hash ended with '24' for the NoriTokenController contract however we have however had success when when the vk hash derived ends with '24' with EthProcessor.

This leads me to believe that the vk we obtain for ethVerifier when the cache is cold and when no other zk programs have been compiled prior to it, is actually different to one where some number of other zk programs have been compiled before it. That the vk hash derived from the compilation of our zk program is not always deterministic in all compilation scenarios.

### Implications

We cannot generate a zk program which yields the same vk hash from a cold cache aka the `18898419980749081858185627310467310990096965437609867313373155526674043887824` hash and have that accepted by Mina for our mint transaction, one which will be accepted by our EthProcessor submit transaction. And we need to invoke some special procedure of compiling some number of used zk programs (otherwise unneeded by our solution and which put us over the webassembly ram limits in the browser) in order invoke some undefined behaviour within o1js in order to obtain a compile ethVerifier program with a vk hash of `15353094949572328638942911616600739835832014383382457564237536370555232424065` which will yield mint transactions which will be accepted by Mina, but would be incompatible with the deployed EthProcessor smart contract which needs to be brought into the NoriTokenController at a later date.

## Option 2 Make real deposit (relies on nori infrastructure to process a deposit and each one will take a mean time of 35 minutes to get to the minting stage, NOT RECOMMENDED, I think o1js team should ignore this section)

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