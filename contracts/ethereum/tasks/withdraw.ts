import { task } from 'hardhat/config';

task('withdrawAll', 'Withdraw all ETH from the bridge to the operator account')
    .setAction(async (_, hre) => {
        const deployedAddress = process.env.NORI_TOKEN_BRIDGE_ADDRESS;
        if (!deployedAddress || !/^0x[a-fA-F0-9]{40}$/.test(deployedAddress)) {
            throw new Error(
                'Invalid or missing environment variable NORI_TOKEN_BRIDGE_ADDRESS'
            );
        }
        console.log(`NORI_TOKEN_BRIDGE_ADDRESS: ${deployedAddress}`);

        const [signer] = await hre.ethers.getSigners();
        const signerAddress = await signer.getAddress();

        const tokenBridge = await hre.ethers.getContractAt(
            'NoriTokenBridge',
            deployedAddress,
            signer
        );

        const bridgeOperator = await tokenBridge.bridgeOperator();
        console.log(`Bridge operator: ${bridgeOperator}`);
        console.log(`Executing signer: ${signerAddress}`);

        if (signerAddress.toLowerCase() !== bridgeOperator.toLowerCase()) {
            throw new Error(
                'Only the bridge operator can withdraw funds.'
            );
        }

        const balanceBefore = await hre.ethers.provider.getBalance(
            deployedAddress
        );
        console.log(
            `Bridge balance before withdrawal: ${hre.ethers.formatEther(balanceBefore)} ETH`
        );

        if (balanceBefore === 0n) {
            throw new Error('No ETH available in the bridge contract.');
        }

        const signerBalanceBefore = await hre.ethers.provider.getBalance(signerAddress);
        console.log(
            `Signer balance before withdrawal: ${hre.ethers.formatEther(signerBalanceBefore)} ETH`
        );

        const tx = await tokenBridge.withdraw();
        console.log(`Withdraw transaction sent: ${tx.hash}`);

        const receipt = await tx.wait(6);
        if (!receipt) throw new Error('No transaction receipt was generated.');

        console.log('Withdrawal confirmed.');
        console.log(`Transaction included in block number: ${receipt.blockNumber}`);

        const balanceAfter = await hre.ethers.provider.getBalance(
            deployedAddress
        );
        console.log(
            `Bridge balance after withdrawal: ${hre.ethers.formatEther(balanceAfter)} ETH`
        );

        const signerBalanceAfter = await hre.ethers.provider.getBalance(signerAddress);
        console.log(
            `Signer balance after withdrawal: ${hre.ethers.formatEther(signerBalanceAfter)} ETH`
        );
    });
