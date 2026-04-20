import 'dotenv/config';
import { writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import '../logger.js';
import { Logger } from 'esm-iso-logger';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = new Logger('PreDeploy');

const ALIGNED_LAYER_GITHUB_RAW =
  'https://raw.githubusercontent.com/yetanotherco/aligned_layer/staging/contracts/script/output';

const NETWORK_TO_ALIGNED_DIR: Record<string, string> = {
  hardhat: 'devnet',
  sepolia: 'sepolia',
  hoodi: 'hoodi',
  mainnet: 'mainnet',
};

/**
 * Fetch the AlignedLayer service manager address for the given network
 * from the aligned_layer GitHub repository.
 */
async function fetchAlignedServiceManagerAddress(ethNetwork: string): Promise<string> {
  const alignedDir = NETWORK_TO_ALIGNED_DIR[ethNetwork];
  if (!alignedDir) {
    logger.fatal(`No aligned layer deployment output known for ETH_NETWORK="${ethNetwork}". Supported: ${Object.keys(NETWORK_TO_ALIGNED_DIR).join(', ')}`);
    process.exit(1);
  }

  const url = `${ALIGNED_LAYER_GITHUB_RAW}/${alignedDir}/alignedlayer_deployment_output.json`;
  logger.log(`Fetching aligned layer deployment output from ${url}`);

  const res = await fetch(url);
  if (!res.ok) {
    logger.fatal(`Failed to fetch aligned layer deployment output: ${res.status} ${res.statusText}`);
    process.exit(1);
  }

  const json = await res.json();
  const address = json?.addresses?.alignedLayerServiceManager;
  if (!address) {
    logger.fatal('alignedLayerServiceManager address not found in deployment output');
    process.exit(1);
  }

  logger.log(`ALIGNED_ETH_SERVICE_MANAGER_ADDRESS=${address}`);
  return address;
}

const possibleEthNetwork = process.env.ETH_NETWORK;

if (!possibleEthNetwork) {
  logger.fatal('Missing required env: ETH_NETWORK');
  process.exit(1);
}

const ethNetwork = possibleEthNetwork;

logger.log(`ETH_NETWORK=${ethNetwork}`);

const alignedServiceManagerAddress = await fetchAlignedServiceManagerAddress(ethNetwork);

// Write output
const envContent = [
  `# AlignedLayer service manager contract address for ${ethNetwork}`,
  `# Source: https://github.com/yetanotherco/aligned_layer`,
  `ALIGNED_ETH_SERVICE_MANAGER_ADDRESS=${alignedServiceManagerAddress}`,
].join('\n') + '\n';

const envFilePath = path.resolve(__dirname, '..', '.env.nori-eth-pre-deploy');
writeFileSync(envFilePath, envContent, { encoding: 'utf8' });

logger.log(`Wrote ${envFilePath}`);
logger.log('Copy these values into your .env:');
logger.log('cat .env.nori-eth-pre-deploy >> .env');
