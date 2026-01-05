import 'dotenv/config';
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "hardhat-preprocessor";
import fs from "fs";
import path from "path";
import "./tasks/lockTokens";
import "./tasks/getTotalDeposited";
import "./tasks/withdraw";

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

/**
 * Loads Foundry-style remappings from remappings.txt
 * Returns a Map for efficient lookup during preprocessing
 */
function loadRemappings(): Map<string, string> {
  const remappingsPath = path.join(__dirname, "remappings.txt");
  const remappings = new Map<string, string>();

  if (!fs.existsSync(remappingsPath)) {
    return remappings;
  }

  const content = fs.readFileSync(remappingsPath, "utf8");

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const [from, to] = trimmed.split("=");
    if (from && to) {
      remappings.set(from.trim(), to.trim());
    }
  }

  return remappings;
}

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },
  networks,
  paths: {
    sources: "./contracts",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  /**
   * Preprocessing to support Foundry-style import remappings
   *
   * Context: Hardhat doesn't natively support Foundry's remappings.txt,
   * and the @nomicfoundation/hardhat-foundry plugin doesn't handle cases
   * where multiple remappings resolve to the same file (HH415 error).
   *
   * This preprocessor rewrites import statements to use resolved paths,
   * allowing Hardhat to compile contracts that depend on Foundry libraries.
   */
  preprocess: {
    eachLine: () => {
      const remappings = loadRemappings();

      return {
        transform: (line: string) => {
          // Only process import statements
          if (!line.match(/^\s*import\s/)) {
            return line;
          }

          // Apply first matching remapping
          for (const [from, to] of remappings) {
            if (line.includes(from)) {
              return line.replace(from, to);
            }
          }

          return line;
        },
      };
    },
  },
};

export default config;
