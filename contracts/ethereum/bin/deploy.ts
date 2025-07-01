import { writeFileSync } from "fs";
import hre from "hardhat";
import path from "path";

async function main() {
  // Get signer info
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  // Print the deployers balance.
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log(`Deployer balance: ${hre.ethers.formatEther(balance)} ETH`);

  // Print network info
  const network = await hre.ethers.provider.getNetwork();
  console.log(`Network: ${network.name} (chainId: ${network.chainId})`);

  // Get the ContractFactory via the Ignition contract name
  const NoriTokenBridge = await hre.ethers.getContractFactory(
    "NoriTokenBridge"
  );
  // Deploy contract
  const noriTokenBridgeDeployedContract = await NoriTokenBridge.deploy();

  const deployTx = noriTokenBridgeDeployedContract.deploymentTransaction();
  if (!deployTx) throw new Error(`NoriTokenBridge did not deploy`);

  // Wait for deployment transaction to be mined
  const receipt = await deployTx.wait();
  if (!receipt) throw new Error("NoriTokenBridge receipt invalid");

  // tokenBridge.target is the deployed address in Ignition typings
  console.log(`NoriTokenBridge deployed to: ${noriTokenBridgeDeployedContract.target}`);
  console.log(`Deployed in block: ${receipt.blockNumber}`);
  console.log(`Gas used for deployment: ${receipt.gasUsed.toString()}`);

  // Write the contract address to .env.nori-token-bridge file
  const envFilePath = path.resolve(__dirname, "..", ".env.nori-token-bridge");
  const envContent = `NORI_TOKEN_BRIDGE_ADDRESS=${noriTokenBridgeDeployedContract.target}\n`;

  writeFileSync(envFilePath, envContent, { encoding: "utf8" });
}

// Run the deployment script and handle errors
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error deploying contract:", error);
    process.exit(1);
  });
