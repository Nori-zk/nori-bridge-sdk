import { task } from 'hardhat/config';
import '../logger.js';
import { Logger } from 'esm-iso-logger';

const logger = new Logger('GetFeeInfo');

export const getFeeInfo = task('getFeeInfo', 'Get current fee configuration and accumulated fees')
    .setAction(async () => ({
        default: async (_args, hre) => {
            const { ethers } = await hre.network.getOrCreate();

            const possibleDeployedAddress = process.env.NORI_ETH_TOKEN_BRIDGE_ADDRESS;

            const issues: string[] = [];

            if (!possibleDeployedAddress || !/^0x[a-fA-F0-9]{40}$/.test(possibleDeployedAddress)) {
                issues.push('Missing or invalid env: NORI_ETH_TOKEN_BRIDGE_ADDRESS (expected 0x-prefixed 40 hex chars)');
            }

            if (issues.length) {
                logger.error('GetFeeInfo encountered errors:');
                issues.forEach((issue, idx) => logger.warn(`  ${idx + 1}: ${issue}`));
                logger.fatal('Due to issues with environment variables getFeeInfo cannot continue.');
                process.exit(1);
            }

            const deployedAddress = possibleDeployedAddress;
            logger.log(`NORI_ETH_TOKEN_BRIDGE_ADDRESS: ${deployedAddress}`);

            const tokenBridge = await ethers.getContractAt(
                'NoriTokenBridge',
                deployedAddress
            );

            const WEI_PER_BRIDGE_UNIT = 10n ** 12n;
            const FEE_DENOMINATOR = 100_000n;

            const lockFeeRate = await tokenBridge.lockFeeRate();
            const unlockFeeRate = await tokenBridge.unlockFeeRate();
            const feeRecipient = await tokenBridge.feeRecipient();
            const accumulatedFees = await tokenBridge.accumulatedFees();
            const bridgeOperator = await tokenBridge.bridgeOperator();

            logger.log(`Bridge operator: ${bridgeOperator}`);
            logger.log(`Fee recipient: ${feeRecipient}`);
            logger.log(`Lock fee rate: ${lockFeeRate} (${(Number(lockFeeRate) / Number(FEE_DENOMINATOR) * 100).toFixed(3)}%)`);
            logger.log(`Unlock fee rate: ${unlockFeeRate} (${(Number(unlockFeeRate) / Number(FEE_DENOMINATOR) * 100).toFixed(3)}%)`);

            const accumulatedFeesWei = accumulatedFees;
            const accumulatedFeesBU = accumulatedFeesWei / WEI_PER_BRIDGE_UNIT;
            logger.log(`Accumulated fees (treasury, rate portion only):`);
            logger.log(`  WEI: ${accumulatedFeesWei.toString()}`);
            logger.log(`  BU: ${accumulatedFeesBU.toString()}`);
            logger.log(`  ETH: ${ethers.formatEther(accumulatedFeesWei)}`);

            // Proof request queue — the other half of every lock fee. Read the
            // address off the bridge rather than the environment: it is
            // immutable, so the bridge is the authority on which queue is live.
            const proofQueueAddress = await tokenBridge.proofQueue();
            const proofQueue = await ethers.getContractAt(
                'NoriProofRequestQueue',
                proofQueueAddress
            );

            const proofRequestQueueFee = await proofQueue.proofRequestQueueFee();
            const maxProofRequestQueueFee = await proofQueue.MAX_PROOF_REQUEST_QUEUE_FEE();
            const queueFees = await proofQueue.accumulatedFees();
            const head = await proofQueue.head();
            const minLockAmountWei = await tokenBridge.MIN_LOCK_AMOUNT_WEI();

            logger.log(`Proof request queue: ${proofQueueAddress}`);
            logger.log(`  Operator: ${await proofQueue.operator()}`);
            logger.log(`  Fee recipient: ${await proofQueue.feeRecipient()}`);
            logger.log(`  Proof request queue fee: ${ethers.formatEther(proofRequestQueueFee)} ETH (max ${ethers.formatEther(maxProofRequestQueueFee)} ETH)`);
            logger.log(`  Requests enqueued to date: ${head.toString()}`);
            logger.log(`  Accumulated fees: ${ethers.formatEther(queueFees)} ETH`);

            logger.log(`Effective lock fee: ${ethers.formatEther(proofRequestQueueFee)} ETH + ${(Number(lockFeeRate) / Number(FEE_DENOMINATOR) * 100).toFixed(3)}% of the deposit`);
            logger.log(`Minimum deposit: ${ethers.formatEther(minLockAmountWei)} ETH`);
        },
    })).build();
