# Nori-Bridge-SDK

A collection of smart/zk contracts, o1js programs and utilities for Nori Bridge.

## Workspaces

1. **[Ethereum Contracts](./contracts/ethereum)**  
   `package: @nori-zk/ethereum-token-bridge`  
   Solidity contracts for the Ethereum side of the bridge.

2. **[Mina Token Bridge](./contracts/mina)**  
   `package: @nori-zk/scrap-mina-token-bridge`  
   Mina zkApp contracts for bridging tokens using the Nori stack.

3. **[o1js ZK Utils](./o1js-zk-utils)**  
   `package: @nori-zk/scrap-o1js-zk-utils`  
   Zero-knowledge programs and helpers built with o1js.

4. **[Workers](./workers)**  
   `package: @nori-zk/workers`  
   A node.js / browser worker abstraction.

5. **[Minimal client](./minimal-client)**   
   An e2e browser devnet test for the whole locking and minting process.

## Usage

```bash
npm install  # Install root dependencies
npm run build  # Build all workspaces
npm run test  # Test all workspaces
npm run test-ci  # Test all workspaces with subset of CI tests.
npm run <command> --workspace=<workspaceName> # Run a specific command in a specific workspace
```

## How to publish

- Dry run the mono repo publish command: `npm run publish -- --dry-run`
- Run the publish command targeting [registry.npm.js](https://registry.npmjs.org/) `npm run publish`


