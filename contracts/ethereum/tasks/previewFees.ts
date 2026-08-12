import { task } from 'hardhat/config';
import '../logger.js';
import { Logger } from 'esm-iso-logger';

const logger = new Logger('PreviewFees');

const DEFAULT_DEPOSITS = '0.0001,0.0005,0.001,0.005,0.01,0.05,0.1,1,10';
const DEFAULT_ETH_USD = 1863;

function eth(wei: bigint, decimals = 6) {
    const frac = (wei % 10n ** 18n).toString().padStart(18, '0');
    return `${wei / 10n ** 18n}.${frac.slice(0, decimals)}`;
}

function usd(wei: bigint, ethUsd: number) {
    const value = (Number(wei) / 1e18) * ethUsd;
    if (value === 0) return '$0';
    if (value < 0.01) return `$${value.toFixed(4)}`;
    if (value < 1000) return `$${value.toFixed(2)}`;
    return `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

export const previewFees = task('previewFees', 'Tabulate what a depositor pays at a given queue fee and lock fee rate')
    .addPositionalArgument({
        name: 'queueFee',
        description: 'Proof request queue fee, in ETH',
        defaultValue: '0.0002',
    })
    .addPositionalArgument({
        name: 'rate',
        description: 'Lock fee rate, 1 unit = 0.001% (500 = 0.5%, 0 for none)',
        defaultValue: '1000',
    })
    .addPositionalArgument({
        name: 'deposits',
        description: 'Comma-separated deposit sizes to tabulate, in ETH',
        defaultValue: DEFAULT_DEPOSITS,
    })
    .setAction(async () => ({
        default: async (args, hre) => {
            const { ethers } = await hre.network.getOrCreate();

            // This deploys throwaway contracts to do the arithmetic, so refuse
            // to run anywhere those deployments would be real.
            const { chainId } = await ethers.provider.getNetwork();
            if (chainId !== 31337n) {
                logger.fatal(`previewFees simulates locally and must run on the built-in Hardhat network, but is connected to chain ${chainId}. Re-run with ETH_NETWORK=hardhat.`);
                process.exit(1);
            }

            const [deployer, dummy] = await ethers.getSigners();
            const ethUsd = Number(process.env.ETH_USD_PRICE ?? DEFAULT_ETH_USD);

            // Deploy the real contracts so every number below comes from the
            // shipped fee logic rather than a copy of it.
            const Queue = await ethers.getContractFactory('NoriProofRequestQueue');
            const queue = await Queue.deploy(
                deployer.address,
                deployer.address,
                ethers.parseEther(args.queueFee)
            );

            const Bridge = await ethers.getContractFactory('NoriTokenBridge');
            const bridge = await Bridge.deploy(
                deployer.address,
                dummy.address,
                dummy.address,
                await queue.getAddress(),
                ethers.ZeroHash,
                ethers.ZeroHash,
                deployer.address
            );
            if (Number(args.rate) > 0) {
                await (await bridge.setLockFeeRate(Number(args.rate))).wait();
            }

            const queueFee = BigInt(await queue.proofRequestQueueFee());
            const maxQueueFee = BigInt(await queue.MAX_PROOF_REQUEST_QUEUE_FEE());
            const minDeposit = BigInt(await bridge.MIN_LOCK_AMOUNT_WEI());
            const minFeeBU = BigInt(await bridge.MIN_FEE_BU());
            const weiPerBridgeUnit = BigInt(await bridge.WEI_PER_BRIDGE_UNIT());
            const feeDenominator = BigInt(await bridge.FEE_DENOMINATOR());
            const rate = Number(await bridge.lockFeeRate());
            const ratePercent = (rate / Number(feeDenominator)) * 100;

            logger.log(`    fee = ${eth(queueFee)} ETH + ${ratePercent.toFixed(3)}% of deposit`);
            logger.log(``);
            logger.log(`  Queue fee    ${eth(queueFee)} ETH (${usd(queueFee, ethUsd)}) per deposit, forwarded to the queue`);
            logger.log(`  Lock rate    ${rate} units = ${ratePercent.toFixed(3)}%, kept by the treasury`);
            if (rate > 0) {
                const minRateFee = minFeeBU * weiPerBridgeUnit;
                logger.log(`  Min rate fee ${eth(minRateFee)} ETH (${usd(minRateFee, ethUsd)}), the rate never collects less`);
            }
            logger.log(`  Min deposit  ${eth(minDeposit)} ETH (${usd(minDeposit, ethUsd)})`);
            logger.log(`  Fee cap      ${eth(maxQueueFee)} ETH, governance cannot set the queue fee above this`);
            logger.log(`  ETH price    $${ethUsd.toLocaleString('en-US')} (override with ETH_USD_PRICE)`);
            logger.log(``);

            const columns = ['Deposit', 'USD', 'Queue fee', 'Rate fee', 'Total fee', 'Fee USD', 'Net locked', 'Fee %'];
            const widths = [13, 9, 11, 11, 11, 9, 13, 8];
            const row = (cells: string[]) =>
                cells.map((cell, i) => cell.padStart(widths[i])).join(' ');

            logger.log(row(columns));
            logger.log('-'.repeat(widths.reduce((a, b) => a + b + 1, -1)));

            for (const entry of args.deposits.split(',')) {
                const deposit = entry.trim();
                if (!deposit) continue;
                const gross = ethers.parseEther(deposit);

                let fee: bigint;
                let net: bigint;
                try {
                    // previewLock applies exactly the rules lockTokens does, so
                    // a revert here is a deposit the bridge would reject.
                    [fee, net] = await bridge.previewLock(gross);
                } catch (err: unknown) {
                    const data = err instanceof Object && 'data' in err ? (err as { data: string }).data : null;
                    const reason = data ? bridge.interface.parseError(data) : null;
                    logger.log(
                        [
                            eth(gross).padStart(widths[0]),
                            usd(gross, ethUsd).padStart(widths[1]),
                            `rejected: ${reason ? reason.name : 'unknown'}`.padStart(30),
                        ].join(' ')
                    );
                    continue;
                }

                logger.log(row([
                    eth(gross),
                    usd(gross, ethUsd),
                    eth(queueFee),
                    eth(fee - queueFee),
                    eth(fee),
                    usd(fee, ethUsd),
                    eth(net),
                    `${((Number(fee) / Number(gross)) * 100).toFixed(3)}%`,
                ]));
            }

            // Below this size the flat fee dominates, so small deposits pay a
            // higher effective rate than the headline percentage.
            if (rate > 0 && queueFee > 0n) {
                const crossover = (queueFee * feeDenominator) / BigInt(rate);
                logger.log(``);
                logger.log(`The rate overtakes the queue fee at ${eth(crossover)} ETH (${usd(crossover, ethUsd)}).`);
            }
        },
    })).build();
