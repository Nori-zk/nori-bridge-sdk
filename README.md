# Nori-Bridge-SDK

A collection of smart/zk contracts, o1js programs and utilities for Nori Bridge.

## Workspaces

1. **[Ethereum Contracts](./contracts/ethereum)**  
   `package: @nori-zk/ethereum-token-bridge`  
   Solidity contracts for the Ethereum side of the bridge.

2. **[Token Bridge](./contracts/mina/token-bridge)**  
   `package: @nori-zk/mina-token-bridge`  
   Mina contracts for bridging tokens using Nori stack.

3. **[Eth Processor](./contracts/mina/eth-processor)**  
   `package: @nori-zk/ethprocessor`  
   Mina contract for Ethereum state commitment to Mina.

4. **[o1js ZK Utils](./o1js-zk-utils)**  
   `package: @nori-zk/o1js-zk-utils`  
   Zero-knowledge programs and helpers built with o1js.

5. **[Workers](./workers)**  
   `package: @nori-zk/workers`  
   A node.js / browser worker abstraction.


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
- Run the publish command targeting a private registry `npm run publish -- --registry https://x.y.com/` (make sure you have an ~/.npmrc file)


