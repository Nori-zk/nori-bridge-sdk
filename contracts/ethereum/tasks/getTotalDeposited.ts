import { task } from 'hardhat/config';

task('getTotalDeposited', 'Get the total deposited/locked')
    .addPositionalArgument({
        name: 'address',
        description: '20-byte attestation hash (0x-prefixed hex string)',
    })
    .addPositionalArgument({
        name: 'attestationHash',
        description: '32-byte attestation hash (0x-prefixed hex string)',
    })
    .setAction(
        async (
            taskArgs: { address: string; attestationHash: string },
            hre: HardhatRuntimeEnvironment
        ) => {
            const { address, attestationHash } = taskArgs;

            // Validate address
            if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
                throw new Error('Address must be 20-byte hex (0x + 40 chars)');
            }

            // Validate attestationHash
            if (!/^0x[a-fA-F0-9]{64}$/.test(attestationHash)) {
                throw new Error(
                    'AttestationHash must be 32-byte hex (0x + 64 chars)'
                );
            }

            const deployedAddress = process.env.NORI_TOKEN_BRIDGE_ADDRESS;
            if (
                !deployedAddress ||
                !/^0x[a-fA-F0-9]{40}$/.test(deployedAddress)
            ) {
                throw new Error(
                    'Invalid or missing environment variable NORI_TOKEN_BRIDGE_ADDRESS'
                );
            }

            const tokenBridge = await hre.ethers.getContractAt(
                'NoriTokenBridge',
                deployedAddress
            );

            const valueFromMapping = await tokenBridge.lockedTokens(
                address,
                attestationHash
            );

            console.log({
                WEI: valueFromMapping.toString(),
                ETH: hre.ethers.formatEther(valueFromMapping),
                HEX: '0x' + valueFromMapping.toString(16),
            });
        }
    );

/*  .setAction(async (taskArgs, hre) => {
        let { address } = taskArgs;
        const { attestationHash } = taskArgs;

        // Validate address format (20 bytes = 40 hex chars + 0x) ?? is this right
        if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
            throw new Error(
                'address must be a 20-byte hex string (0x followed by 40 hex chars)'
            );
        }

        // Validate attestationHash format (32 bytes = 64 hex chars + 0x)
        if (!/^0x[a-fA-F0-9]{64}$/.test(attestationHash)) {
            throw new Error(
                'attestationHash must be a 32-byte hex string (0x followed by 64 hex chars)'
            );
        }

        const deployedAddress = process.env.NORI_TOKEN_BRIDGE_ADDRESS;
        if (!deployedAddress || !/^0x[a-fA-F0-9]{40}$/.test(deployedAddress)) {
            throw new Error(
                'Invalid or missing environment variable NORI_TOKEN_BRIDGE_ADDRESS'
            );
        }
        console.log(`NORI_TOKEN_BRIDGE_ADDRESS: ${deployedAddress}`);

        const tokenBridge = await hre.ethers.getContractAt(
            'NoriTokenBridge',
            deployedAddress
        );

        const valueFromMapping = await tokenBridge.lockedTokens(
            address,
            attestationHash
        );

        console.log({
            WEI: valueFromMapping.toString(),
            ETH: hre.ethers.formatEther(valueFromMapping),
            HEX: '0x' + valueFromMapping.toString(16),
        });
    });
*/
