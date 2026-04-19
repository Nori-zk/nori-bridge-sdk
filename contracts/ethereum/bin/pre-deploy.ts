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

/**
 * Fetch the tip state hash from the Mina daemon GraphQL endpoint.
 */
async function fetchMinaTipStateHash(minaRpcUrl: string): Promise<string> {
  logger.log(`Fetching tip state hash from ${minaRpcUrl}`);

  const query = 'query { bestChain(maxLength: 1) { stateHashField } }';

  const res = await fetch(minaRpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
    logger.fatal(`Mina daemon request failed: ${res.status} ${res.statusText}`);
    process.exit(1);
  }

  const json = await res.json();
  const bestChain = json?.data?.bestChain;
  if (!bestChain || bestChain.length === 0) {
    logger.fatal('No blocks returned from bestChain query');
    process.exit(1);
  }

  const tipStateHash = bestChain[0].stateHashField;
  if (!tipStateHash) {
    logger.fatal('stateHashField not found in bestChain response');
    process.exit(1);
  }

  logger.log(`MINA_TIP_STATE_HASH=${tipStateHash}`);
  return tipStateHash;
}

const possibleEthNetwork = process.env.ETH_NETWORK;
const possibleMinaRpcUrl = process.env.MINA_RPC_NETWORK_URL;

const issues: string[] = [];

if (!possibleEthNetwork) issues.push('Missing required env: ETH_NETWORK');
if (!possibleMinaRpcUrl) issues.push('Missing required env: MINA_RPC_NETWORK_URL');

if (issues.length) {
  logger.error('PreDeploy encountered errors:');
  issues.forEach((issue, idx) => logger.warn(`  ${idx + 1}: ${issue}`));
  logger.fatal('Due to issues with environment variables pre-deploy cannot continue.');
  process.exit(1);
}

const ethNetwork = possibleEthNetwork;
const minaRpcUrl = possibleMinaRpcUrl;

logger.log(`ETH_NETWORK=${ethNetwork}`);
logger.log(`MINA_RPC_NETWORK_URL=${minaRpcUrl}`);

// Fetch both. All must succeed before writing anything.
const alignedServiceManagerAddress = await fetchAlignedServiceManagerAddress(ethNetwork);
const tipStateHash = await fetchMinaTipStateHash(minaRpcUrl);

// Write output
const envContent = [
  `# AlignedLayer service manager contract address for ${ethNetwork}`,
  `# Source: https://github.com/yetanotherco/aligned_layer`,
  `ALIGNED_ETH_SERVICE_MANAGER_ADDRESS=${alignedServiceManagerAddress}`,
  `# Mina tip state hash fetched from ${minaRpcUrl}`,
  `MINA_TIP_STATE_HASH=${tipStateHash}`,
].join('\n') + '\n';

const envFilePath = path.resolve(__dirname, '..', '.env.nori-eth-pre-deploy');
writeFileSync(envFilePath, envContent, { encoding: 'utf8' });

logger.log(`Wrote ${envFilePath}`);
logger.log('Copy these values into your .env:');
logger.log('cat .env.nori-eth-pre-deploy >> .env');
