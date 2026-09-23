import { task } from 'hardhat/config';
import '../logger.js';
import { Logger } from 'esm-iso-logger';

const logger = new Logger('SetProofRequestQueueFee');

// Mirrors NoriProofRequestQueue; validated here so a bad value fails before
// it costs a transaction.
const PROOF_REQUEST_QUEUE_FEE_GRANULARITY_WEI = 10n ** 12n;
const MAX_PROOF_REQUEST_QUEUE_FEE_WEI = 5n * 10n ** 16n; // 0.05 ETH

export const setProofRequestQueueFee = task('setProofRequestQueueFee', 'Set the per-request fee on the proof request queue (in ETH)')
    .addPositionalArgument({
        name: 'fee',
        description: 'Fee per proof request, in ETH (e.g. 0.001). Must be a multiple of 0.000001 ETH',
    })
    .setAction(async () => ({
        default: async (args, hre) => {
            const { ethers } = await hre.network.getOrCreate();
            const { fee } = args;

            const possibleDeployedAddress = process.env.NORI_ETH_PROOF_QUEUE_ADDRESS;

            const issues: string[] = [];

            if (!possibleDeployedAddress || !/^0x[a-fA-F0-9]{40}$/.test(possibleDeployedAddress)) {
                issues.push('Missing or invalid env: NORI_ETH_PROOF_QUEUE_ADDRESS (expected 0x-prefixed 40 hex chars)');
            }

            let parsedFeeWei: bigint | null = null;
            try {
                parsedFeeWei = ethers.parseEther(fee);
            } catch {
                issues.push(`Invalid fee: ${fee} (expected a decimal amount of ETH, e.g. 0.001)`);
            }

            if (parsedFeeWei !== null) {
                if (parsedFeeWei > MAX_PROOF_REQUEST_QUEUE_FEE_WEI) {
                    issues.push(`Fee ${fee} ETH exceeds MAX_PROOF_REQUEST_QUEUE_FEE of ${ethers.formatEther(MAX_PROOF_REQUEST_QUEUE_FEE_WEI)} ETH`);
                }
                if (parsedFeeWei % PROOF_REQUEST_QUEUE_FEE_GRANULARITY_WEI !== 0n) {
                    issues.push(`Fee ${fee} ETH is not a multiple of ${ethers.formatEther(PROOF_REQUEST_QUEUE_FEE_GRANULARITY_WEI)} ETH`);
                }
            }

            if (issues.length) {
                logger.error('SetProofRequestQueueFee encountered errors:');
                issues.forEach((issue, idx) => logger.warn(`  ${idx + 1}: ${issue}`));
                logger.fatal('Due to issues with arguments setProofRequestQueueFee cannot continue.');
                process.exit(1);
            }

            const deployedAddress = possibleDeployedAddress;
            const feeWei = parsedFeeWei as bigint;
            logger.log(`NORI_ETH_PROOF_QUEUE_ADDRESS: ${deployedAddress}`);

            const [signer] = await ethers.getSigners();
            logger.log(`Signer address: ${await signer.getAddress()}`);

            const proofQueue = await ethers.getContractAt(
                'NoriProofRequestQueue',
                deployedAddress,
                signer
            );

            const currentFee = await proofQueue.proofRequestQueueFee();
            logger.log(`Current proof request queue fee: ${ethers.formatEther(currentFee)} ETH (${currentFee.toString()} wei)`);
            logger.log(`Setting proof request queue fee to: ${ethers.formatEther(feeWei)} ETH (${feeWei.toString()} wei)`);
            logger.log('Note: the bridge adds this fee to every deposit, and its minimum deposit scales with it.');

            const tx = await proofQueue.setProofRequestQueueFee(feeWei);
            logger.log(`Tx sent: ${tx.hash}`);
            const receipt = await tx.wait();
            if (!receipt) throw new Error('No tx receipt was generated');
            logger.log(`Confirmed in block: ${receipt.blockNumber}`);
        },
    })).build();
