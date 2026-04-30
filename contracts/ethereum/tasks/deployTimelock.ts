import { writeFileSync } from 'fs';
import { task } from 'hardhat/config';
import path from 'path';
import { fileURLToPath } from 'url';
import '../logger.js';
import { Logger } from 'esm-iso-logger';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = new Logger('DeployTimelock');

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const addressRe = /^0x[a-fA-F0-9]{40}$/;

const parseAddressList = (raw: string): string[] =>
    raw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

export const deployTimelock = task(
    'deployTimelock',
    'Deploy OpenZeppelin TimelockController (per DEPLOYMENT.md §7)'
)
    .setAction(async () => ({
        default: async (_args, hre) => {
            const { ethers } = await hre.network.getOrCreate();

            const [deployer] = await ethers.getSigners();
            const balance = await ethers.provider.getBalance(deployer.address);
            const network = await ethers.provider.getNetwork();

            const possibleEthNetwork = process.env.ETH_NETWORK;
            const possibleMinDelay = process.env.NORI_ETH_TIMELOCK_MIN_DELAY_SEC;
            const possibleProposers = process.env.NORI_ETH_TIMELOCK_PROPOSERS;
            const possibleExecutors = process.env.NORI_ETH_TIMELOCK_EXECUTORS;
            // Optional. Defaults to address(0) — disables the post-deploy admin
            // role so the contract is fully self-administered.
            const possibleAdmin = process.env.NORI_ETH_TIMELOCK_ADMIN ?? ZERO_ADDRESS;

            const issues: string[] = [];

            if (!possibleEthNetwork) issues.push('Missing required env: ETH_NETWORK');

            let minDelay = 0n;
            if (!possibleMinDelay) {
                issues.push(
                    'Missing required env: NORI_ETH_TIMELOCK_MIN_DELAY_SEC (seconds, e.g. 172800 for 48h)'
                );
            } else {
                try {
                    minDelay = BigInt(possibleMinDelay);
                    if (minDelay < 0n) throw new Error('must be >= 0');
                } catch (err) {
                    issues.push(
                        `NORI_ETH_TIMELOCK_MIN_DELAY_SEC must be a non-negative integer (got '${possibleMinDelay}': ${(err as Error).message})`
                    );
                }
            }

            let proposers: string[] = [];
            if (!possibleProposers) {
                issues.push(
                    'Missing required env: NORI_ETH_TIMELOCK_PROPOSERS (comma-separated 0x addresses, typically the SAFE)'
                );
            } else {
                proposers = parseAddressList(possibleProposers);
                if (proposers.length === 0) {
                    issues.push('NORI_ETH_TIMELOCK_PROPOSERS must contain at least one address');
                } else {
                    proposers.forEach((addr, idx) => {
                        if (!addressRe.test(addr)) {
                            issues.push(
                                `NORI_ETH_TIMELOCK_PROPOSERS[${idx}] is not a valid address: '${addr}'`
                            );
                        }
                    });
                }
            }

            let executors: string[] = [];
            if (!possibleExecutors) {
                issues.push(
                    "Missing required env: NORI_ETH_TIMELOCK_EXECUTORS (comma-separated 0x addresses; use 0x0…0 for permissionless execution)"
                );
            } else {
                executors = parseAddressList(possibleExecutors);
                if (executors.length === 0) {
                    issues.push('NORI_ETH_TIMELOCK_EXECUTORS must contain at least one address');
                } else {
                    executors.forEach((addr, idx) => {
                        if (!addressRe.test(addr)) {
                            issues.push(
                                `NORI_ETH_TIMELOCK_EXECUTORS[${idx}] is not a valid address: '${addr}'`
                            );
                        }
                    });
                }
            }

            if (!addressRe.test(possibleAdmin)) {
                issues.push(
                    `NORI_ETH_TIMELOCK_ADMIN must be a valid address (got '${possibleAdmin}'); omit to default to address(0)`
                );
            }

            if (issues.length) {
                logger.error('DeployTimelock encountered errors:');
                issues.forEach((issue, idx) => logger.warn(`  ${idx + 1}: ${issue}`));
                logger.fatal(
                    'Due to issues with environment variables deployTimelock cannot continue.'
                );
                process.exit(1);
            }

            const admin = possibleAdmin;

            logger.log(`Deploying with account: ${deployer.address}`);
            logger.log(`Deployer balance: ${ethers.formatEther(balance)} ETH`);
            logger.log(`Network: ${network.name} (chainId: ${network.chainId})`);
            logger.log('Configuration:');
            logger.log(`  NORI_ETH_TIMELOCK_MIN_DELAY_SEC:   ${minDelay.toString()} seconds`);
            logger.log(`  NORI_ETH_TIMELOCK_PROPOSERS:   [${proposers.join(', ')}]`);
            logger.log(`  NORI_ETH_TIMELOCK_EXECUTORS:   [${executors.join(', ')}]`);
            logger.log(
                `  NORI_ETH_TIMELOCK_ADMIN:       ${admin}${admin === ZERO_ADDRESS ? ' (self-administered)' : ''}`
            );

            logger.log('Deploying TimelockController...');
            const TimelockController = await ethers.getContractFactory('TimelockController');
            const timelock = await TimelockController.deploy(minDelay, proposers, executors, admin);
            const timelockDeployTx = timelock.deploymentTransaction();
            if (!timelockDeployTx) throw new Error('TimelockController did not deploy');
            const timelockReceipt = await timelockDeployTx.wait();
            if (!timelockReceipt) throw new Error('TimelockController receipt invalid');
            logger.log(`TimelockController deployed to: ${timelock.target}`);
            logger.log(`Deployed in block: ${timelockReceipt.blockNumber}`);
            logger.log(`Gas used: ${timelockReceipt.gasUsed.toString()}`);

            const envFilePath = path.resolve(__dirname, '..', '.env.nori-eth-timelock');
            const env = {
                NORI_ETH_TIMELOCK_ADDRESS: timelock.target as string,
                NORI_ETH_TIMELOCK_MIN_DELAY_SEC: minDelay.toString(),
            };
            const envContent =
                Object.entries(env)
                    .map(([key, value]) => `${key}=${value}`)
                    .join('\n') + '\n';
            writeFileSync(envFilePath, envContent, { encoding: 'utf8' });

            logger.log(`Wrote ${envFilePath}`);
            logger.log('Environment variables for future use:');
            for (const [key, value] of Object.entries(env)) {
                logger.log(`${key}=${value}`);
            }
            logger.log(
                'Next: feed NORI_ETH_TIMELOCK_ADDRESS as NORI_ETH_BRIDGE_OPERATOR_ADDRESS into the bridge deploy (DEPLOYMENT.md §9).'
            );
        },
    }))
    .build();
