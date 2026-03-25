# Nori Token Bridge - Ethereum Contracts

## Exports

```typescript
import { noriTokenBridgeJson } from '@nori-zk/ethereum-token-bridge';
```

## Installation

`npm install`

## Configuration

All scripts read from `.env`. The full set of env vars:

```bash
# Ethereum =================================================================
# Deployer/operator private key (bare hex, no 0x prefix)
ETH_PRIVATE_KEY=deadbeef...
# JSON-RPC endpoint
ETH_RPC_URL=https://ethereum-holesky.core.chainstack.com/<api-key>
# Network label: hardhat, sepolia, mainnet, hoodi
ETH_NETWORK=sepolia

# Bridge operator ===========================================================
# Safe address or EOA to serve as bridge operator; defaults to deployer if unset
NORI_ETH_BRIDGE_OPERATOR_ADDRESS=0x...

# Fee configuration (optional, can be set post-deploy) ======================
# Treasury address for fee withdrawal
NORI_ETH_BRIDGE_FEE_RECIPIENT_ADDRESS=0x...
# Lock fee rate, 1 unit = 0.001%, e.g. 500 = 0.5%
NORI_ETH_BRIDGE_LOCK_FEE_RATE=500
# Unlock fee rate, 1 unit = 0.001%, e.g. 500 = 0.5%
NORI_ETH_BRIDGE_UNLOCK_FEE_RATE=500

# Mina ======================================================================
# Mina daemon GraphQL RPC URL (required by pre-deploy helper)
MINA_RPC_NETWORK_URL=https://devnet-plain-1.gcp.o1test.net/graphql

# Aligned layer =============================================================
# AlignedLayer service manager contract address on Ethereum.
# Resolved automatically by the pre-deploy helper from
# https://github.com/yetanotherco/aligned_layer for the target network.
ALIGNED_ETH_SERVICE_MANAGER_ADDRESS=0x...

# Deploy parameters (written by pre-deploy helper) ==========================
# Tip state hash of the Mina chain at deploy time (fetched from Mina daemon)
MINA_TIP_STATE_HASH=0x...

# Deploy outputs (written by deploy task) ====================================
# Deployed contract addresses
NORI_ETH_TOKEN_BRIDGE_ADDRESS=0x...
NORI_ETH_MINA_STATE_SETTLEMENT_ADDRESS=0x...
NORI_ETH_MINA_ACCOUNT_VALIDATION_ADDRESS=0x...

# Testing ====================================================================
# Set to true to enable the lockTokens test facility
NORI_ETH_TOKEN_BRIDGE_TEST_MODE=true
```

## Testing

`npm run test`

## Build

`npm run build`

## Pre-deploy

The deploy task requires parameters that must be fetched from external sources: the AlignedLayer service manager address for the target network, and the current Mina tip state hash. The pre-deploy helper resolves these automatically.

Requires:
- `ETH_NETWORK`
- `MINA_RPC_NETWORK_URL`

```bash
npm run pre-deploy
```

This writes `.env.nori-eth-pre-deploy` containing:

```bash
# AlignedLayer service manager contract address for the target network
# Source: https://github.com/yetanotherco/aligned_layer
ALIGNED_ETH_SERVICE_MANAGER_ADDRESS=0xFf731AB7b3653dc66878DC77E851D174f472d137
# Mina tip state hash fetched from the Mina daemon
MINA_TIP_STATE_HASH=0x7b2291b3e03efab440c1eb22503bec4be29e56c27e56b5c4cc9f5e1b1e9e1a3f
```

Copy these values into your `.env`:

```bash
cat .env.nori-eth-pre-deploy >> .env
```

See `.env.nori-eth-pre-deploy.example` for the expected format.

## Deploy

Deploys three contracts in sequence: MinaAccountValidation, MinaStateSettlement, and NoriTokenBridge.

First copy the values from [pre-deploy](#pre-deploy) into your `.env`.

Requires:
- `ETH_PRIVATE_KEY`
- `ETH_RPC_URL`
- `ETH_NETWORK`
- `NORI_ETH_BRIDGE_OPERATOR_ADDRESS` (optional, defaults to deployer)
- `NORI_ETH_BRIDGE_FEE_RECIPIENT_ADDRESS` (optional)
- `NORI_ETH_BRIDGE_LOCK_FEE_RATE` (optional)
- `NORI_ETH_BRIDGE_UNLOCK_FEE_RATE` (optional)

```bash
npm run deploy
```

You will see output something like:

```sh
Running on network "sepolia"
Using RPC URL: https://ethereum-sepolia.core.chainstack.com/<api-key>
One private key loaded for deployment.
Deploying with account: 0xC7e910807Dd2E3F49B34EfE7133cfb684520Da69
Deployer balance: 40.718863431964256704 ETH
Network: sepolia (chainId: 11155111)
Configuration:
  NORI_ETH_BRIDGE_OPERATOR_ADDRESS: (defaulting to deployer)
  NORI_ETH_BRIDGE_FEE_RECIPIENT_ADDRESS: (not set)
  NORI_ETH_BRIDGE_LOCK_FEE_RATE: (not set)
  NORI_ETH_BRIDGE_UNLOCK_FEE_RATE: (not set)
Deploying MinaAccountValidation...
MinaAccountValidation deployed to: 0x...
Gas used: 123456
Deploying MinaStateSettlement...
MinaStateSettlement deployed to: 0x...
Gas used: 234567
Deploying NoriTokenBridge...
NoriTokenBridge deployed to: 0x142B9d3fE3Caa2CE9DaA607A262Dc8561C694006
Deployed in block: 10511301
Gas used: 296589
Wrote .env.nori-eth-token-bridge
Environment variables for future use:
NORI_ETH_TOKEN_BRIDGE_ADDRESS=0x142B9d3fE3Caa2CE9DaA607A262Dc8561C694006
NORI_ETH_MINA_STATE_SETTLEMENT_ADDRESS=0x...
NORI_ETH_MINA_ACCOUNT_VALIDATION_ADDRESS=0x...
NORI_ETH_BRIDGE_OPERATOR_ADDRESS=0xC7e910807Dd2E3F49B34EfE7133cfb684520Da69
```

A file `.env.nori-eth-token-bridge` will have been created with the deployed contract addresses.

## Lock (for testing purposes)

Make sure your .env is set to deploy to the correct testing network. Copy `NORI_ETH_TOKEN_BRIDGE_ADDRESS` from `.env.nori-eth-token-bridge`. Also you must add `NORI_ETH_TOKEN_BRIDGE_TEST_MODE=true` to run this test facility.

Requires:
- `ETH_PRIVATE_KEY`
- `ETH_RPC_URL`
- `ETH_NETWORK`
- `NORI_ETH_TOKEN_BRIDGE_ADDRESS`
- `NORI_ETH_TOKEN_BRIDGE_TEST_MODE=true`

`npm run test:lock <codeChallengeHex> <amountInETH (min 0.0001, max 0.001, defaults to 0.0001)>`

e.g. `npm run test:lock 0x1edc891c0ea28b6157e8460304e20a534f3b29a9dbb2d499a58fa2d1de6b3c4a 0.0001`

One can (again for testing purposes) lock periodically in a loop, every 383 seconds (approximately once every consensus period):

`npm run test:lock-loop <codeChallengeHex>`

**Caution** this is just a test facility, don't lock real ETH using this process.

## Get total deposited

Requires:
- `ETH_RPC_URL`
- `ETH_NETWORK`
- `NORI_ETH_TOKEN_BRIDGE_ADDRESS`

`npm run get-deposited <codeChallengeHex>`

e.g. `npm run get-deposited 0x1edc891c0ea28b6157e8460304e20a534f3b29a9dbb2d499a58fa2d1de6b3c4a`

## Withdraw

Requires:
- `ETH_PRIVATE_KEY`
- `ETH_RPC_URL`
- `ETH_NETWORK`
- `NORI_ETH_TOKEN_BRIDGE_ADDRESS`

`npm run withdraw`

## Package details

This package exports a single variable, `noriTokenBridgeJson`, which is a Hardhat artifact JSON object representing the compiled contract metadata (ABI, bytecode, etc.).

It is provided as an ES module export, allowing you to import it using ES module syntax.
