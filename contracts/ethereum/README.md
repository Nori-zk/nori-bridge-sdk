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

# Mina zkApp tokenID (required) =============================================
# 32-byte hex of the Mina NoriStorage zkApp tokenID expected during unlock validation.
# Set on the bridge as an immutable at deployment time.
NORI_ETH_BRIDGE_ZKAPP_TOKEN_ID=0x...

# Mina zkApp verification key hash (required) ===============================
# keccak256 of the ABI-encoded NoriStorage zkApp verification key.
# Set on the bridge as an immutable at deployment time.
NORI_ETH_BRIDGE_ZKAPP_VERIFICATION_KEY_HASH=0x...

# Fee configuration =========================================================
# Treasury address for fee withdrawal. If provided, set as the initial feeRecipient
# at deployment; otherwise it can be configured later via `setFeeRecipient`.
NORI_ETH_BRIDGE_FEE_RECIPIENT_ADDRESS=0x...
# Lock fee rate, 1 unit = 0.001%, e.g. 500 = 0.5% (optional, set post-deploy)
NORI_ETH_BRIDGE_LOCK_FEE_RATE=500
# Unlock fee rate, 1 unit = 0.001%, e.g. 500 = 0.5% (optional, set post-deploy)
NORI_ETH_BRIDGE_UNLOCK_FEE_RATE=500

# Aligned layer =============================================================
# AlignedLayer service manager contract address on Ethereum.
# Resolved automatically by the pre-deploy helper from
# https://github.com/yetanotherco/aligned_layer for the target network.
ALIGNED_ETH_SERVICE_MANAGER_ADDRESS=0x...

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

The deploy task requires the AlignedLayer service manager address for the target network. The pre-deploy helper resolves it automatically.

Requires:
- `ETH_NETWORK`

```bash
npm run pre-deploy
```

This writes `.env.nori-eth-pre-deploy` containing:

```bash
# AlignedLayer service manager contract address for the target network
# Source: https://github.com/yetanotherco/aligned_layer
ALIGNED_ETH_SERVICE_MANAGER_ADDRESS=0xFf731AB7b3653dc66878DC77E851D174f472d137
```

Copy this into your `.env`:

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
- `NORI_ETH_BRIDGE_ZKAPP_TOKEN_ID` (32-byte hex; set as immutable on the deployed bridge)
- `NORI_ETH_BRIDGE_ZKAPP_VERIFICATION_KEY_HASH` (32-byte hex; set as immutable on the deployed bridge)
- `NORI_ETH_BRIDGE_OPERATOR_ADDRESS` (optional, defaults to deployer)
- `NORI_ETH_BRIDGE_FEE_RECIPIENT_ADDRESS` (optional; if set, applied at construction)
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
  NORI_ETH_BRIDGE_ZKAPP_TOKEN_ID: 0x1b848805a3db129b6b41adca52c9b6f380d58dc9c283f73ce17466a01b90d361
  NORI_ETH_BRIDGE_ZKAPP_VERIFICATION_KEY_HASH: 0xdc9c283f73ce17466a01b90d36141b848805a3db129b6b80d581adca52c9b6f3
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

## Fee info

Query the current fee configuration: lock/unlock rates, fee recipient, accumulated fees, and bridge operator.

Requires:
- `ETH_RPC_URL`
- `ETH_NETWORK`
- `NORI_ETH_TOKEN_BRIDGE_ADDRESS`

```bash
npm run get-fee-info
```

## Set fee rate

Set the lock or unlock fee rate. The rate is expressed in units of 0.001%, so 500 = 0.5%, max 10000 = 10%. Must be called by the bridge operator.

Requires:
- `ETH_PRIVATE_KEY`
- `ETH_RPC_URL`
- `ETH_NETWORK`
- `NORI_ETH_TOKEN_BRIDGE_ADDRESS`

```bash
npm run set-fee-rate lock 500
npm run set-fee-rate unlock 500
```

## Set fee recipient

Set the treasury address that receives accumulated fees via `withdrawFees()`. Must be called by the bridge operator.

Requires:
- `ETH_PRIVATE_KEY`
- `ETH_RPC_URL`
- `ETH_NETWORK`
- `NORI_ETH_TOKEN_BRIDGE_ADDRESS`

```bash
npm run set-fee-recipient 0x...
```

## Withdraw fees

Withdraw accumulated protocol fees to the fee recipient. Must be called by the fee recipient address.

Requires:
- `ETH_PRIVATE_KEY`
- `ETH_RPC_URL`
- `ETH_NETWORK`
- `NORI_ETH_TOKEN_BRIDGE_ADDRESS`

```bash
npm run withdraw-fees
```

## Set bridge operator

Rotate the bridge operator to a new address. Must be called by the current bridge operator.

Requires:
- `ETH_PRIVATE_KEY`
- `ETH_RPC_URL`
- `ETH_NETWORK`
- `NORI_ETH_TOKEN_BRIDGE_ADDRESS`

```bash
npm run set-bridge-operator 0x...
```

## Package details

This package exports a single variable, `noriTokenBridgeJson`, which is a Hardhat artifact JSON object representing the compiled contract metadata (ABI, bytecode, etc.).

It is provided as an ES module export, allowing you to import it using ES module syntax.
