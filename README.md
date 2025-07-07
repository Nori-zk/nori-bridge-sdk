# Nori-Bridge-SDK

A collection of smart/zk contracts and o1js programs for Nori Bridge.

## Workspaces

1. **[o1js-zk-programs](./o1js-zk-programs)**  
   `workspace: o1js-zk-programs`  
   Zero-knowledge programs and utilities built with o1js.

2. **[Eth Processor](./contracts/mina/eth-processor)**  
   `workspace: contracts/mina/eth-processor`  
   Mina contract for Ethereum state commitment to Mina.

3. **[Minter](./contracts/mina/minter)**  
   `workspace: contracts/mina/minter`  
   Token minter contracts for Nori Bridge.

4. **[Ethereum Contracts](./contracts/ethereum)**  
   `workspace: contracts/ethereum`  
   Solidity contracts for the Ethereum source side of the bridge.

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


