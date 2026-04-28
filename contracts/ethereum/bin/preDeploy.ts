// Load environment variables from .env file
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
        throw new Error(`No aligned layer deployment output known for ETH_NETWORK="${ethNetwork}". Supported: ${Object.keys(NETWORK_TO_ALIGNED_DIR).join(', ')}`);
    }

    const url = `${ALIGNED_LAYER_GITHUB_RAW}/${alignedDir}/alignedlayer_deployment_output.json`;
    logger.log(`Fetching aligned layer deployment output from ${url}`);

    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Failed to fetch aligned layer deployment output: ${res.status} ${res.statusText}`);
    }

    const json = await res.json();
    const address = json?.addresses?.alignedLayerServiceManager;
    if (!address) {
        throw new Error('alignedLayerServiceManager address not found in deployment output');
    }

    logger.log(`ALIGNED_ETH_SERVICE_MANAGER_ADDRESS=${address}`);
    return address;
}

/**
 * Fetch the genesis validators root from the beacon chain consensus API.
 */
async function fetchGenesisValidatorsRoot(ethConsensusRpc: string): Promise<string> {
    const url = `${ethConsensusRpc}/eth/v1/beacon/genesis`;
    logger.log(`Fetching genesis from ${url}`);

    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Failed to fetch genesis: ${res.status} ${res.statusText}`);
    }

    const json = await res.json();
    const genesisValidatorsRoot = json?.data?.genesis_validators_root;
    if (!genesisValidatorsRoot) {
        throw new Error('genesis_validators_root not found in response');
    }

    logger.log(`NORI_ETH_GENESIS_ROOT=${genesisValidatorsRoot}`);
    return genesisValidatorsRoot;
}

const possibleEthNetwork = process.env.ETH_NETWORK;
const possibleEthConsensusRpc = process.env.ETH_CONSENSUS_RPC;

const issues: string[] = [];

if (!possibleEthNetwork)
    issues.push('Missing required env: ETH_NETWORK');
if (!possibleEthConsensusRpc)
    issues.push('Missing required env: ETH_CONSENSUS_RPC');

if (issues.length) {
    const formatted = [
        'PreDeploy encountered issues:',
        ...issues.flatMap((issue, idx) => {
            const lines = issue.split('\n');
            return lines.map((line, lineIdx) =>
                lineIdx === 0 ? `\t${idx + 1}: ${line}` : `\t   ${line}`
            );
        }),
    ].join('\n');
    logger.fatal(formatted);
    process.exit(1);
}

const ethNetwork = possibleEthNetwork as string;
const ethConsensusRpc = possibleEthConsensusRpc as string;

logger.log(`ETH_NETWORK=${ethNetwork}`);

async function preDeploy() {
    const alignedServiceManagerAddress = await fetchAlignedServiceManagerAddress(ethNetwork);
    const genesisValidatorsRoot = await fetchGenesisValidatorsRoot(ethConsensusRpc);

    // Write output
    const envContent = [
        `# AlignedLayer service manager contract address for ${ethNetwork}`,
        `# Source: https://github.com/yetanotherco/aligned_layer`,
        `ALIGNED_ETH_SERVICE_MANAGER_ADDRESS=${alignedServiceManagerAddress}`,
        `# Ethereum chain genesis validators root`,
        `NORI_ETH_GENESIS_ROOT=${genesisValidatorsRoot}`,
    ].join('\n') + '\n';

    const envFilePath = path.resolve(__dirname, '..', '.env.nori-eth-pre-deploy');
    writeFileSync(envFilePath, envContent, { encoding: 'utf8' });

    logger.log(`Wrote ${envFilePath}`);
    logger.log('Copy these values into your .env:');
    logger.log('cat .env.nori-eth-pre-deploy >> .env');
}

preDeploy().catch((err) => {
    logger.fatal(
        `PreDeploy function encountered an error.\n${String(err)}`
    );
    process.exit(1);
});
