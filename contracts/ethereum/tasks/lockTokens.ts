/*import { task, types } from 'hardhat/config';

task('lockTokens', 'Lock tokens with attestation hash and optional amount')
    .addPositionalParam(
        'attestationHash',
        '32-byte attestation hash (0x-prefixed hex string)'
    )
    .addPositionalParam(
        'amount',
        'Amount of Ether to lock (max 0.001 ETH)',
        '0.000001',
        types.string,
        true
    )
    .setAction(async (taskArgs, hre) => {
        const { attestationHash } = taskArgs;
        let { amount } = taskArgs;

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
        const lockAmount = hre.ethers.parseEther(parsedAmount.toString());

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

        const [signer] = await hre.ethers.getSigners();
        const signerAddress = await signer.getAddress();
        const balance = await hre.ethers.provider.getBalance(
            signerAddress
        );
        console.log(`Signer balance: ${hre.ethers.formatEther(balance)} ETH`);
        console.log(`Signer address: ${signerAddress}`);

        const tokenBridge = await hre.ethers.getContractAt(
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
    });
*/