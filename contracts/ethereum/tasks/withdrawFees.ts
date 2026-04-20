import { task } from 'hardhat/config';
import '../logger.js';
import { Logger } from 'esm-iso-logger';

const logger = new Logger('WithdrawFees');

export const withdrawFees = task('withdrawFees', 'Withdraw accumulated protocol fees to the fee recipient')
    .setAction(async () => ({
        default: async (_args, hre) => {
            const { ethers } = await hre.network.getOrCreate();

            const possibleDeployedAddress = process.env.NORI_ETH_TOKEN_BRIDGE_ADDRESS;

            const issues: string[] = [];

            if (!possibleDeployedAddress || !/^0x[a-fA-F0-9]{40}$/.test(possibleDeployedAddress)) {
                issues.push('Missing or invalid env: NORI_ETH_TOKEN_BRIDGE_ADDRESS (expected 0x-prefixed 40 hex chars)');
            }

            if (issues.length) {
                logger.error('WithdrawFees encountered errors:');
                issues.forEach((issue, idx) => logger.warn(`  ${idx + 1}: ${issue}`));
                logger.fatal('Due to issues with environment variables withdrawFees cannot continue.');
                process.exit(1);
            }

            const deployedAddress = possibleDeployedAddress;
            logger.log(`NORI_ETH_TOKEN_BRIDGE_ADDRESS: ${deployedAddress}`);

            const [signer] = await ethers.getSigners();
            logger.log(`Signer address: ${await signer.getAddress()}`);

            const tokenBridge = await ethers.getContractAt(
                'NoriTokenBridge',
                deployedAddress,
                signer
            );

            const WEI_PER_BRIDGE_UNIT = 10n ** 12n;

            const feeRecipient = await tokenBridge.feeRecipient();
            const accumulatedFees = await tokenBridge.accumulatedFees();
            const accumulatedFeesBU = accumulatedFees / WEI_PER_BRIDGE_UNIT;

            logger.log(`Fee recipient: ${feeRecipient}`);
            logger.log(`Accumulated fees:`);
            logger.log(`  WEI: ${accumulatedFees.toString()}`);
            logger.log(`  BU: ${accumulatedFeesBU.toString()}`);
            logger.log(`  ETH: ${ethers.formatEther(accumulatedFees)}`);

            if (accumulatedFees === 0n) {
                logger.log('No fees to withdraw.');
                return;
            }

            let tx;
            try {
                tx = await tokenBridge.withdrawFees();
            } catch (err: unknown) {
                const data = err instanceof Object && 'data' in err ? (err as { data: string }).data : null;
                const reason = data ? tokenBridge.interface.parseError(data) : null;
                if (reason) {
                    logger.fatal(`withdrawFees reverted: ${reason.name}`);
                } else {
                    logger.fatal(`withdrawFees reverted: ${err instanceof Error ? err.message : String(err)}`);
                }
                process.exit(1);
            }

            logger.log(`Tx sent: ${tx.hash}`);
            const receipt = await tx.wait();
            if (!receipt) throw new Error('No tx receipt was generated');
            logger.log(`Confirmed in block: ${receipt.blockNumber}`);

            const feesEvent = receipt.logs
                .map((log: { topics: string[]; data: string }) => { try { return tokenBridge.interface.parseLog(log); } catch { return null; } })
                .find((parsed: { name: string } | null) => parsed?.name === 'FeesWithdrawn');

            if (feesEvent) {
                const amount = feesEvent.args.amount;
                const amountBU = amount / WEI_PER_BRIDGE_UNIT;
                logger.log(`Withdrawn:`);
                logger.log(`  WEI: ${amount.toString()}`);
                logger.log(`  BU: ${amountBU.toString()}`);
                logger.log(`  ETH: ${ethers.formatEther(amount)}`);
            }
        },
    })).build();
