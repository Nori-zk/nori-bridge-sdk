
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

# Observed behaviour

Litenet test passes but devnet fails on `WALLET_MOCK_signAndSendMintProofCache` invocation, the noriMint proof is generated and proved locally succefully but rejected upon submission.