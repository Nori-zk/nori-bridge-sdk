import { task } from 'hardhat/config';

export const lockTokens = task('lockTokens', 'Lock tokens with attestation hash and optional amount')
    .addPositionalArgument({
        name: 'attestationHash',
        description: '32-byte attestation hash (0x-prefixed hex string)',
    })
    .addPositionalArgument({
        name: 'amount',
        description: 'Amount of Ether to lock (max 0.001 ETH)',
        defaultValue: '0.000001',
    })
    .setAction(async () => ({
        default: async (args, hre) => {
            const { ethers } = await hre.network.connect();
            const { attestationHash } = args;
            let { amount } = args;

            // Validate attestationHash format (32 bytes = 64 hex chars + 0x)
            if (!/^0x[a-fA-F0-9]{64}$/.test(attestationHash)) {
                throw new Error(
                    'attestationHash must be a 32-byte hex string (0x followed by 64 hex chars)'
                );
            }

            // Validate amount (string to float)
            const parsedAmount = parseFloat(amount);
            if (isNaN(parsedAmount)) {
                throw new Error(`Invalid amount: ${amount} is not a number`);
            }
            if (parsedAmount > 0.001) {
                throw new Error('Amount must not exceed 0.001 ETH');
            }

            // Parse amount to BigInt using ethers
            const lockAmount = ethers.parseEther(parsedAmount.toString());

            if (
                !process.env.NORI_TOKEN_BRIDGE_TEST_MODE ||
                process.env.NORI_TOKEN_BRIDGE_TEST_MODE !== 'true'
            ) {
                throw new Error(
                    "Not in test mode! Denied the use of the deposit facility. It's just for testing!"
                );
            }

            const deployedAddress = process.env.NORI_TOKEN_BRIDGE_ADDRESS;
            if (!deployedAddress || !/^0x[a-fA-F0-9]{40}$/.test(deployedAddress)) {
                throw new Error(
                    'Invalid or missing environment variable NORI_TOKEN_BRIDGE_ADDRESS'
                );
            }
            console.log(`NORI_TOKEN_BRIDGE_ADDRESS: ${deployedAddress}`);

            const [signer] = await ethers.getSigners();
            const signerAddress = await signer.getAddress();
            const balance = await ethers.provider.getBalance(signerAddress);
            console.log(`Signer balance: ${ethers.formatEther(balance)} ETH`);
            console.log(`Signer address: ${signerAddress}`);

            const tokenBridge = await ethers.getContractAt(
                'NoriTokenBridge',
                deployedAddress,
                signer
            );

            const tx = await tokenBridge.lockTokens(attestationHash, {
                value: lockAmount,
            });
            console.log(`Lock tx sent: ${tx.hash}`);

            const receipt = await tx.wait();
            if (!receipt) throw new Error('No tx receipt was generated');

            console.log(`Lock confirmed with ${parsedAmount} ETH`);
            console.log(
                `Transaction included in block number: ${receipt.blockNumber}`
            );
        },
    })).build();