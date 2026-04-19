import { task } from 'hardhat/config';
import '../logger.js';
import { Logger } from 'esm-iso-logger';

const logger = new Logger('SetFeeRecipient');

export const setFeeRecipient = task('setFeeRecipient', 'Set the fee recipient (treasury) address')
    .addPositionalArgument({
        name: 'recipient',
        description: 'New fee recipient address (0x-prefixed)',
    })
    .setAction(async () => ({
        default: async (args, hre) => {
            const { ethers } = await hre.network.connect();
            const { recipient } = args;

            const possibleDeployedAddress = process.env.NORI_ETH_TOKEN_BRIDGE_ADDRESS;

            const issues: string[] = [];

            if (!possibleDeployedAddress || !/^0x[a-fA-F0-9]{40}$/.test(possibleDeployedAddress)) {
                issues.push('Missing or invalid env: NORI_ETH_TOKEN_BRIDGE_ADDRESS (expected 0x-prefixed 40 hex chars)');
            }
            if (!/^0x[a-fA-F0-9]{40}$/.test(recipient)) {
                issues.push('recipient must be a valid address (0x-prefixed 40 hex chars)');
            }

            if (issues.length) {
                logger.error('SetFeeRecipient encountered errors:');
                issues.forEach((issue, idx) => logger.warn(`  ${idx + 1}: ${issue}`));
                logger.fatal('Due to issues with arguments setFeeRecipient cannot continue.');
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

            const currentRecipient = await tokenBridge.feeRecipient();
            logger.log(`Current fee recipient: ${currentRecipient}`);
            logger.log(`Setting fee recipient to: ${recipient}`);

            const tx = await tokenBridge.setFeeRecipient(recipient);
            logger.log(`Tx sent: ${tx.hash}`);
            const receipt = await tx.wait();
            if (!receipt) throw new Error('No tx receipt was generated');
            logger.log(`Confirmed in block: ${receipt.blockNumber}`);
        },
    })).build();
