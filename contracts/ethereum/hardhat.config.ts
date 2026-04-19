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
import './logger.js';
import { Logger } from 'esm-iso-logger';

const logger = new Logger('HardhatConfig');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import "./tasks/lockTokens";
import "./tasks/getTotalDeposited";
import "./tasks/deploy";
import "./tasks/getFeeInfo";
import "./tasks/setFeeRate";
import "./tasks/setFeeRecipient";
import "./tasks/withdrawFees";
import "./tasks/setBridgeOperator";

import { lockTokens } from './tasks/lockTokens.js';
import { getTotalDeposited } from './tasks/getTotalDeposited.js';
import { deploy } from './tasks/deploy.js';
import { getFeeInfo } from './tasks/getFeeInfo.js';
import { setFeeRate } from './tasks/setFeeRate.js';
import { setFeeRecipient } from './tasks/setFeeRecipient.js';
import { withdrawFees } from './tasks/withdrawFees.js';
import { setBridgeOperator } from './tasks/setBridgeOperator.js';

const possibleNetworkName = process.env.ETH_NETWORK;
const possibleRpcUrl = process.env.ETH_RPC_URL;
const possiblePrivateKey = process.env.ETH_PRIVATE_KEY;

const issues: string[] = [];

if (!possibleNetworkName) issues.push('Missing required env: ETH_NETWORK');
if (possibleNetworkName && possibleNetworkName !== 'hardhat') {
  if (!possibleRpcUrl) issues.push('Missing required env: ETH_RPC_URL');
  if (!possiblePrivateKey) issues.push('Missing required env: ETH_PRIVATE_KEY');
}

if (issues.length) {
  logger.error('HardhatConfig encountered errors:');
  issues.forEach((issue, idx) => logger.warn(`  ${idx + 1}: ${issue}`));
  logger.fatal('Due to issues with environment variables hardhat cannot continue.');
  process.exit(1);
}

const networkName = possibleNetworkName;

interface NetworkConfig {
  url: string;
  accounts: string[];
  type: 'http';
}

const networks: Record<string, NetworkConfig> = {};

if (networkName !== 'hardhat') {
  networks[networkName] = {
    url: possibleRpcUrl as string,
    accounts: [possiblePrivateKey as string],
    type: 'http',
  };
}

logger.log(`Running on network "${networkName}"`);
if (networkName === 'hardhat') {
  logger.log('Using built-in Hardhat network for local testing.');
} else {
  logger.log(`Using RPC URL: ${networks[networkName].url}`);
  logger.log('One private key loaded for deployment.');
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
  tasks: [lockTokens, getTotalDeposited, deploy, getFeeInfo, setFeeRate, setFeeRecipient, withdrawFees, setBridgeOperator], plugins: [
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
  test: {
    mocha: {
      rootHooks: {
        afterAll() {
          // Force exit after tests — ethers .once() listeners keep the process alive
          setTimeout(() => process.exit(0), 100);
        },
      },
    },
  },
  paths: {
    sources: "./contracts",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};

export default config;
