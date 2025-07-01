import 'dotenv/config';
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

function assertEnvVar(name: string): string {
  const val = process.env[name];
  if (!val || val.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return val;
}

const networkName = process.env.ETH_NETWORK;
if (!networkName) {
  throw new Error("Environment variable ETH_NETWORK is required.");
}

interface NetworkConfig {
  url: string;
  accounts: string[];
}

const networks: Record<string, NetworkConfig> = {};

if (networkName !== "hardhat") {
  const rpcUrl = assertEnvVar("ETH_RPC_URL");
  const privateKey = assertEnvVar("ETH_PRIVATE_KEY");

  networks[networkName] = {
    url: rpcUrl,
    accounts: [privateKey],
  };
}

console.log(`Running on network "${networkName}"`);
if (networkName === "hardhat") {
  console.log(`Using built-in Hardhat network for local testing.`);
} else {
  console.log(`Using RPC URL: ${networks[networkName].url}`);
  console.log(`One private key loaded for deployment.`);
}

const config: HardhatUserConfig = {
  solidity: "0.8.28",
  networks,
};

export default config;
