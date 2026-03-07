import 'dotenv/config';
import { type HardhatUserConfig } from 'hardhat/config';
import hardhatTypechain from '@nomicfoundation/hardhat-typechain';
import hardhatEthers from '@nomicfoundation/hardhat-ethers';
import hardhatToolboxMochaEthers from '@nomicfoundation/hardhat-toolbox-mocha-ethers';
import hardhatEthersChaiMatchers from '@nomicfoundation/hardhat-ethers-chai-matchers';
import hardhatMocha from '@nomicfoundation/hardhat-mocha';
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import "./tasks/lockTokens";
import "./tasks/getTotalDeposited";
import "./tasks/withdraw";

import { lockTokens } from './tasks/lockTokens.js';
import { getTotalDeposited } from './tasks/getTotalDeposited.js';

function assertEnvVar(name: string): string {
  const val = process.env[name];
  if (!val || val.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return val;
}

const networkName = process.env.ETH_NETWORK;
if (!networkName) {
  throw new Error('Environment variable ETH_NETWORK is required.');
}

// import { NetworkUserConfig } from 'hardhat/dist/src/types/config.js';
//const x: NetworkUserConfig;

interface NetworkConfig {
  url: string;
  accounts: string[];
  type: 'http';
}

const networks: Record<string, NetworkConfig> = {};

if (networkName !== 'hardhat') {
  const rpcUrl = assertEnvVar('ETH_RPC_URL');
  const privateKey = assertEnvVar('ETH_PRIVATE_KEY');

  networks[networkName] = {
    url: rpcUrl,
    accounts: [privateKey],
    type: 'http',
  };
}

console.log(`Running on network "${networkName}"`);
if (networkName === 'hardhat') {
  console.log(`Using built-in Hardhat network for local testing.`);
} else {
  console.log(`Using RPC URL: ${networks[networkName].url}`);
  console.log(`One private key loaded for deployment.`);
}

/**
 * Loads Foundry-style remappings from remappings.txt
 * Returns an array of "prefix=target" strings for solc settings
 */
function loadRemappings(): string[] {
  const remappingsPath = path.join(__dirname, "remappings.txt");

  if (!fs.existsSync(remappingsPath)) {
    return [];
  }

  const content = fs.readFileSync(remappingsPath, "utf8");
  const remappings: string[] = [];

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    remappings.push(trimmed);
  }

  return remappings;
}

const config: HardhatUserConfig = {


  networks,
  tasks: [lockTokens, getTotalDeposited], plugins: [
    hardhatMocha,
    hardhatTypechain,
    hardhatEthers,
    hardhatToolboxMochaEthers,
    hardhatEthersChaiMatchers,
  ],
  solidity: {
    version: "0.8.28",
    settings: {
      remappings: loadRemappings(),
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },
  paths: {
    sources: "./contracts",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};

export default config;
