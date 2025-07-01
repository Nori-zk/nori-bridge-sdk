import "dotenv/config";
import hre from "hardhat";
import { Signer } from "ethers";

const testMode = (process.env.NORI_TOKEN_BRIDGE_TEST_MODE || 'false') === "true";
if (!testMode) {
  throw new Error(
    "Not in test mode! Denied the use of the deposit facility. It's just for testing!"
  );
}

const deployedAddress = process.env.NORI_TOKEN_BRIDGE_ADDRESS as string;
if (!deployedAddress || !deployedAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
  throw new Error(
    "Invalid or missing environment variable NORI_TOKEN_BRIDGE_ADDRESS. Must be a valid Ethereum address."
  );
}

const testLockAmount = "0.000001";

async function main() {
  const [hardhatSigner] = await hre.ethers.getSigners();

  // Cast to ethers Signer
  const signer = hardhatSigner as unknown as Signer;

  // Print signer address
  const balance = await hre.ethers.provider.getBalance(signer.getAddress());
  console.log(`Signer balance: ${hre.ethers.formatEther(balance)} ETH`);

  // Get an existing deployed contract instance
  const noriTokenBridge = await hre.ethers.getContractAt(
    "NoriTokenBridge",
    deployedAddress,
    signer
  );

  // Convert amount from human readable
  const amount = hre.ethers.parseEther(testLockAmount);

  // Lock amount in the token bridge
  const tx = await noriTokenBridge.lockTokens({ value: amount });
  console.log(`Lock tx sent: ${tx.hash}`);

  // Await tx
  const receipt = await tx.wait();

  if (!receipt) throw new Error('No tx receipt was generated');
  
  console.log(`Lock confirmed with ${testLockAmount} ETH`);
  console.log(`Transaction included in block number: ${receipt.blockNumber}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
