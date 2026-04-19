import { task } from 'hardhat/config';
import '../logger.js';
import { Logger } from 'esm-iso-logger';

const logger = new Logger('GetTotalDeposited');

export const getTotalDeposited = task('getTotalDeposited', 'Get the total deposited/locked')
    .addPositionalArgument({
        name: 'codeChallenge',
        description: '32-byte code challenge (0x-prefixed hex string)',
    })
    .setAction(async () => ({
        default: async (args, hre) => {
            const { ethers } = await hre.network.connect();
            const { codeChallenge } = args;

            const possibleDeployedAddress = process.env.NORI_ETH_TOKEN_BRIDGE_ADDRESS;

            const issues: string[] = [];

            if (!/^0x[a-fA-F0-9]{64}$/.test(codeChallenge)) {
                issues.push('codeChallenge must be a 32-byte hex string (0x followed by 64 hex chars)');
            }
            if (!possibleDeployedAddress || !/^0x[a-fA-F0-9]{40}$/.test(possibleDeployedAddress)) {
                issues.push('Missing or invalid env: NORI_ETH_TOKEN_BRIDGE_ADDRESS (expected 0x-prefixed 40 hex chars)');
            }

            if (issues.length) {
                logger.error('GetTotalDeposited encountered errors:');
                issues.forEach((issue, idx) => logger.warn(`  ${idx + 1}: ${issue}`));
                logger.fatal('Due to issues with environment variables getTotalDeposited cannot continue.');
                process.exit(1);
            }

            const deployedAddress = possibleDeployedAddress;
            logger.log(`NORI_ETH_TOKEN_BRIDGE_ADDRESS: ${deployedAddress}`);

            const tokenBridge = await ethers.getContractAt(
                'NoriTokenBridge',
                deployedAddress
            );

            const valueFromMapping = await tokenBridge.lockedTokens(
                codeChallenge
            );

            const WEI_PER_BRIDGE_UNIT = 10n ** 12n;
            const weiValue = valueFromMapping * WEI_PER_BRIDGE_UNIT;
            logger.log(`WEI: ${weiValue.toString()}`);
            logger.log(`BU: ${valueFromMapping.toString()}`);
            logger.log(`ETH: ${ethers.formatEther(weiValue)}`);
            logger.log(`HEX (BU): 0x${valueFromMapping.toString(16)}`);
        },
    })).build();
