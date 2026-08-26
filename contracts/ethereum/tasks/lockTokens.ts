import { task } from 'hardhat/config';
import '../logger.js';
import { Logger } from 'esm-iso-logger';

const logger = new Logger('LockTokens');

export const lockTokens = task('lockTokens', 'Lock tokens with code challenge and optional amount')
    .addPositionalArgument({
        name: 'codeChallenge',
        description: '32-byte code challenge (0x-prefixed hex string)',
    })
    .addPositionalArgument({
        name: 'amount',
        description: 'Amount of Ether to lock (min 0.001, max 0.005 ETH)',
        defaultValue: '0.001',
    })
    .setAction(async () => ({
        default: async (args, hre) => {
            const { ethers } = await hre.network.getOrCreate();
            const { codeChallenge } = args;
            const { amount } = args;

            const possibleTestMode = process.env.NORI_ETH_TOKEN_BRIDGE_TEST_MODE;
            const possibleDeployedAddress = process.env.NORI_ETH_TOKEN_BRIDGE_ADDRESS;

            const issues: string[] = [];

            if (!possibleTestMode || possibleTestMode !== 'true') {
                issues.push("NORI_ETH_TOKEN_BRIDGE_TEST_MODE must be 'true'. This facility is just for testing!");
            }
            if (!possibleDeployedAddress || !/^0x[a-fA-F0-9]{40}$/.test(possibleDeployedAddress)) {
                issues.push('Missing or invalid env: NORI_ETH_TOKEN_BRIDGE_ADDRESS (expected 0x-prefixed 40 hex chars)');
            }
            if (!/^0x[a-fA-F0-9]{64}$/.test(codeChallenge)) {
                issues.push('codeChallenge must be a 32-byte hex string (0x followed by 64 hex chars)');
            }

            const parsedAmount = parseFloat(amount);
            if (isNaN(parsedAmount)) {
                issues.push(`Invalid amount: ${amount} is not a number`);
            }
            if (parsedAmount > 0.005) {
                issues.push('Amount must not exceed 0.005 ETH');
            }

            if (issues.length) {
                logger.error('LockTokens encountered errors:');
                issues.forEach((issue, idx) => logger.warn(`  ${idx + 1}: ${issue}`));
                logger.fatal('Due to issues with environment variables lockTokens cannot continue.');
                process.exit(1);
            }

            const deployedAddress = possibleDeployedAddress;
            const lockAmount = ethers.parseEther(parsedAmount.toString());
            const WEI_PER_BRIDGE_UNIT = 10n ** 12n;

            logger.log(`NORI_ETH_TOKEN_BRIDGE_ADDRESS: ${deployedAddress}`);

            const [signer] = await ethers.getSigners();
            const signerAddress = await signer.getAddress();
            const balance = await ethers.provider.getBalance(signerAddress);
            logger.log(`Signer address: ${signerAddress}`);
            logger.log(`Signer balance: ${ethers.formatEther(balance)} ETH`);

            const tokenBridge = await ethers.getContractAt(
                'NoriTokenBridge',
                deployedAddress,
                signer
            );

            let tx;
            try {
                tx = await tokenBridge.lockTokens(codeChallenge, {
                    value: lockAmount,
                });
            } catch (err: unknown) {
                const data = err instanceof Object && 'data' in err ? (err as { data: string }).data : null;
                const reason = data ? tokenBridge.interface.parseError(data) : null;
                if (reason) {
                    logger.fatal(`lockTokens reverted: ${reason.name}`);
                } else {
                    logger.fatal(`lockTokens reverted: ${err instanceof Error ? err.message : String(err)}`);
                }
                process.exit(1);
            }
            logger.log(`Lock tx sent: ${tx.hash}`);

            const receipt = await tx.wait();
            if (!receipt) throw new Error('No tx receipt was generated');
            logger.log(`Transaction included in block number: ${receipt.blockNumber}`);

            const lockEvent = receipt.logs
                .map((log: { topics: string[]; data: string }) => { try { return tokenBridge.interface.parseLog(log); } catch { return null; } })
                .find((parsed: { name: string } | null) => parsed?.name === 'TokensLocked');

            if (lockEvent) {
                const netWei = lockEvent.args.amount;
                const feeWei = lockEvent.args.fee;
                const grossWei = netWei + feeWei;
                const grossBU = grossWei / WEI_PER_BRIDGE_UNIT;
                const feeBU = feeWei / WEI_PER_BRIDGE_UNIT;
                const netBU = netWei / WEI_PER_BRIDGE_UNIT;

                logger.log(`Gross:`);
                logger.log(`  WEI: ${grossWei.toString()}`);
                logger.log(`  BU: ${grossBU.toString()}`);
                logger.log(`  ETH: ${ethers.formatEther(grossWei)}`);
                logger.log(`  HEX (BU): 0x${grossBU.toString(16)}`);
                logger.log(`Fee:`);
                logger.log(`  WEI: ${feeWei.toString()}`);
                logger.log(`  BU: ${feeBU.toString()}`);
                logger.log(`  ETH: ${ethers.formatEther(feeWei)}`);
                logger.log(`  HEX (BU): 0x${feeBU.toString(16)}`);
                logger.log(`Net locked:`);
                logger.log(`  WEI: ${netWei.toString()}`);
                logger.log(`  BU: ${netBU.toString()}`);
                logger.log(`  ETH: ${ethers.formatEther(netWei)}`);
                logger.log(`  HEX (BU): 0x${netBU.toString(16)}`);
            }

            const currentLocked = await tokenBridge.lockedTokens(codeChallenge);
            const currentLockedWei = currentLocked * WEI_PER_BRIDGE_UNIT;
            logger.log(`Total locked for code challenge:`);
            logger.log(`  WEI: ${currentLockedWei.toString()}`);
            logger.log(`  BU: ${currentLocked.toString()}`);
            logger.log(`  ETH: ${ethers.formatEther(currentLockedWei)}`);
            logger.log(`  HEX (BU): 0x${currentLocked.toString(16)}`);
        },
    })).build();
