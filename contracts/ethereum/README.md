# Nori Token Bridge - Source Contract

## Installation

`npm install`

## Configuration

Env vars (create a .env file):

```
ETH_PRIVATE_KEY=
ETH_RPC_URL=
ETH_NETWORK=
```

- **ETH_PRIVATE_KEY**: Ethereum contract deployer private key
- **ETH_RPC_URL**: Ethereum RPC endpoint
- **ETH_NETWORK**: Ethereum network label e.g. 'holesky'

## Testing

`npm run test`

## Build

`npm run build`

## Deploy

Make sure your .env is set to deploy to the correct network.

`npm run deploy`

You will see output like:

```sh
Running on network "holesky"
Using RPC URL: https://ethereum-holesky.core.chainstack.com/<api-key>
One private key loaded for deployment.
Deploying with account: 0xC7xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
Deployer balance: 100.0 ETH
Network: holesky (chainId: 17000)
NoriTokenBridge deployed to: 0xfCxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
Deployed in block: 3840406
Gas used for deployment: 296589
```

A file `.env.nori-token-bridge` will have been created with `NORI_TOKEN_BRIDGE_ADDRESS` set within it.

## Lock (for testing purposes)

Make sure your .env is set to deploy to the correct testing network. Copy NORI_TOKEN_BRIDGE_ADDRESS from the deploy stage. Also you must add `NORI_TOKEN_BRIDGE_TEST_MODE=true` to run this test facility.

`npm run test:lock <attestationHashHex> <optionalAmountToLock (defaults to 0.000001)>`

`npx hardhat --network $ETH_NETWORK lockTokens <attestationHashHex> <optionalAmountToLock (defaults to 0.000001)>`

**Caution** this is just a test facility, don't lock real ETH using this process.

## Get total deposited

Ensure NORI_TOKEN_BRIDGE_ADDRESS is within your .env file.

`npm run get-deposited <depositorAddressHex> <attestationHashHex>`

e.g. `npm run get-deposited 0xc7e910807dd2e3f49b34efe7133cfb684520da69 0x13cceb5b591e742c13fd7f3894f97139c964606f2928eefdc234e8a3a55c10b1`