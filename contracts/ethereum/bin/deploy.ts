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

  // Resolve bridge operator address from env, defaulting to deployer
  const bridgeOperator = process.env.NORI_ETH_BRIDGE_OPERATOR_ADDRESS || deployer.address;
  console.log(`Bridge operator: ${bridgeOperator}`);

  // Get the ContractFactory via the Ignition contract name
  const NoriTokenBridge = await hre.ethers.getContractFactory(
    "NoriTokenBridge"
  );
  // Deploy contract with explicit bridgeOperator
  const noriTokenBridgeDeployedContract = await NoriTokenBridge.deploy(bridgeOperator);

  const deployTx = noriTokenBridgeDeployedContract.deploymentTransaction();
  if (!deployTx) throw new Error(`NoriTokenBridge did not deploy`);

  // Wait for deployment transaction to be mined
  const receipt = await deployTx.wait();
  if (!receipt) throw new Error("NoriTokenBridge receipt invalid");

  // tokenBridge.target is the deployed address in Ignition typings
  console.log(`NoriTokenBridge deployed to: ${noriTokenBridgeDeployedContract.target}`);
  console.log(`Deployed in block: ${receipt.blockNumber}`);
  console.log(`Gas used for deployment: ${receipt.gasUsed.toString()}`);

  // Optional post-deploy fee configuration
  const feeRecipient = process.env.NORI_ETH_BRIDGE_FEE_RECIPIENT_ADDRESS;
  if (feeRecipient) {
    console.log(`Setting fee recipient: ${feeRecipient}`);
    const tx1 = await noriTokenBridgeDeployedContract.setFeeRecipient(feeRecipient);
    await tx1.wait();
  }

  const lockFeeRate = process.env.NORI_ETH_BRIDGE_LOCK_FEE_RATE;
  if (lockFeeRate) {
    console.log(`Setting lock fee rate: ${lockFeeRate} (1 unit = 0.001%)`);
    const tx2 = await noriTokenBridgeDeployedContract.setLockFeeRate(parseInt(lockFeeRate));
    await tx2.wait();
  }

  const unlockFeeRate = process.env.NORI_ETH_BRIDGE_UNLOCK_FEE_RATE;
  if (unlockFeeRate) {
    console.log(`Setting unlock fee rate: ${unlockFeeRate} (1 unit = 0.001%)`);
    const tx3 = await noriTokenBridgeDeployedContract.setUnlockFeeRate(parseInt(unlockFeeRate));
    await tx3.wait();
  }

  // Write the contract address to .env.nori-eth-token-bridge file
  const envFilePath = path.resolve(__dirname, "..", ".env.nori-eth-token-bridge");
  const envContent = `NORI_ETH_TOKEN_BRIDGE_ADDRESS=${noriTokenBridgeDeployedContract.target}\n`;

  writeFileSync(envFilePath, envContent, { encoding: "utf8" });
}

// Run the deployment script and handle errors
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error deploying contract:", error);
    process.exit(1);
  });
