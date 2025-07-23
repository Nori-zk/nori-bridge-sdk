// Load environment variables from .env file
import 'dotenv/config';
// Other imports
import {
    Mina,
    PrivateKey,
    AccountUpdate,
    NetworkId,
    fetchAccount,
    PublicKey,
} from 'o1js';
import { Logger, LogPrinter } from '@nori-zk/proof-conversion';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { rootDir } from '../utils.js';
import { EthProcessor } from '../ethProcessor.js';
import {
    Bytes32,
    Bytes32FieldPair,
    compileAndVerifyContracts,
    EthVerifier,
    ethVerifierVkHash,
} from '@nori-zk/o1js-zk-utils';
import { ethProcessorVkHash } from '../integrity/EthProcessor.VKHash.js';

const logger = new Logger('Deploy');

new LogPrinter('[NoriEthProcessor]', [
    'log',
    'info',
    'warn',
    'error',
    'debug',
    'fatal',
    'verbose',
]);

const missingEnvVariables: string[] = [];

// Declare sender private key
const deployerKeyBase58 = process.env.SENDER_PRIVATE_KEY as string;

// Get or generate a zkAppPrivateKey
let zkAppPrivateKeyWasCreated = false;
if (!process.env.ZKAPP_PRIVATE_KEY) {
    zkAppPrivateKeyWasCreated = true;
    logger.log('ZKAPP_PRIVATE_KEY not set, generating a random key.');
}
let zkAppPrivateKeyBase58 =
    process.env.ZKAPP_PRIVATE_KEY ?? PrivateKey.random().toBase58();
if (zkAppPrivateKeyWasCreated) {
    logger.info(`Created a new ZKAppPrivate key.`);
    process.env.ZKAPP_PRIVATE_KEY = zkAppPrivateKeyBase58;
}
let deployerKey: PrivateKey;
try {
    deployerKey = PrivateKey.fromBase58(deployerKeyBase58);
} catch (e) {
    const error = e as unknown as Error;
    logger.fatal(
        `Could not parse deployerKeyBase58. Are you sure your SENDER_PRIVATE_KEY environment variable is correct.\n${error.stack}`
    );
    process.exit(1);
}
let zkAppPrivateKey: PrivateKey;
try {
    zkAppPrivateKey = PrivateKey.fromBase58(zkAppPrivateKeyBase58);
} catch (e) {
    const error = e as unknown as Error;
    logger.fatal(
        `Could not parse zkAppPrivateKeyBase58. Are you sure your ZKAPP_PRIVATE_KEY environment variable is correct.\n${error.stack}`
    );
    process.exit(1);
}

// Network configuration
const networkUrl =
    process.env.MINA_RPC_NETWORK_URL || 'http://localhost:3000/graphql';
const fee = Number(process.env.TX_FEE || 0.1) * 1e9; // in nanomina (1 billion = 1.0 mina)

// Validate envs
if (!networkUrl) missingEnvVariables.push('MINA_RPC_NETWORK_URL');
if (!deployerKeyBase58) missingEnvVariables.push('SENDER_PRIVATE_KEY');
if (missingEnvVariables.length > 0) {
    logger.fatal(
        `Missing required environment variable(s): ${missingEnvVariables.join(
            ' and '
        )}`
    );
    process.exit(1);
}

// Capture arguments
const storeHashHex = process.argv[2];
const possibleAdminPublicKeyBase58 = process.argv[3];

// Determine issues if any:
const issues: string[] = [];
// Enforce that if zkAppPrivateKeyWasCreated then we must provide a storeHash
if (zkAppPrivateKeyWasCreated && storeHashHex === undefined) {
    const issue = `A request to create a new zkContract was made, but first argument storeHashHex was missing.`;
    issues.push(issue);
}
// Enfore that if !zkAppPrivateKeyWasCreated then a possibleStoreHash must not be provided (would mislead the user)
if (!zkAppPrivateKeyWasCreated && storeHashHex !== undefined) {
    const issue = `A request to update the verification key of an existing zkApp was made, but first argument storeHashHex was provided. If the zkApp already exists, then this facility is purely for updating the verification key. Please see the README.md and use 'npm run update update-store-hash <storeHashHex>' instead.`;
    issues.push(issue);
}
// Ensure that if !zkAppPrivateKeyWasCreated adminPublicKeyBase58 is not provided
if (!zkAppPrivateKeyWasCreated && possibleAdminPublicKeyBase58 !== undefined) {
    const issue = [
        `A request to update the verification key of an existing zkApp was made, but a second cli argument adminPublicKeyBase58 was provided '${possibleAdminPublicKeyBase58}'.`,
        `Please know if the ZKApp has already been deployed, then it is not not possible to override that set admin.`,
        `Please remove this second argument and try again.`,
        `Note only the admin account has permissions to do this. You must set SENDER_PRIVATE_KEY=<ContractAdminPrivateKeyBase58String> in your '.env' otherwise you will be denied.`,
    ].join('\n');
    issues.push(issue);
}

// If we have issues print them nicely and exit.
if (issues.length) {
    const formatted = [
        'Deploy encountered issues:',
        ...issues.flatMap((issue, idx) => {
            const lines = issue.split('\n');
            return lines.map((line, lineIdx) =>
                lineIdx === 0 ? `\t${idx + 1}: ${line}` : `\t   ${line}`
            );
        }),
    ].join('\n');

    logger.fatal(formatted);
    process.exit(1);
}

// Process store hash argument
if (storeHashHex)
    logger.log(
        `A store hash hex was provided, as a first argument and has value of: '${storeHashHex}'`
    );
let possibleStoreHash: Bytes32 | undefined = undefined;
try {
    possibleStoreHash = storeHashHex
        ? Bytes32.fromHex(storeHashHex)
        : undefined;
} catch (err) {
    logger.fatal(
        `Store hash was not provided as a first argument or was invalid.\n${
            (err as Error).stack
        }`
    );
    process.exit(1);
}

// Process adminPublicKeyBase58 argument
let adminPublicKey: PublicKey;
if (possibleAdminPublicKeyBase58) {
    logger.log(
        `An adminPublicKeyBase58 was provided, as a second argument and has value of: '${possibleAdminPublicKeyBase58}'`
    );
}
if (zkAppPrivateKeyWasCreated && possibleAdminPublicKeyBase58 === undefined) {
    logger.warn(
        'Note a second cli argument adminPublicKeyBase58 was not defined. Reverting to using the public key derived from the set SENDER_PRIVATE_KEY environment variable.'
    );
    adminPublicKey = deployerKey.toPublicKey();
} else if (zkAppPrivateKeyWasCreated) {
    try {
        adminPublicKey = PublicKey.fromBase58(possibleAdminPublicKeyBase58);
    } catch (e) {
        const error = e as unknown as Error;
        logger.fatal(
            `Could not parse adminPublicKeyBase58 provided as a second cli argument. Are you sure your argument is correct.\n${error.stack}`
        );
        process.exit(1);
    }
}

// Util to save ZKAPP_PRIVATE_KEY and ZKAPP_ADDRESS to a file.
function writeSuccessDetailsToEnvFileFile(zkAppAddressBase58: string) {
    // Write env file.
    const env = {
        ZKAPP_PRIVATE_KEY: zkAppPrivateKeyBase58,
        ZKAPP_ADDRESS: zkAppAddressBase58,
    };
    const envFileStr =
        Object.entries(env)
            .map(([key, value]) => `${key}=${value}`)
            .join('\n') + `\n`;
    const envFileOutputPath = resolve(rootDir, '..', '.env.nori-eth-processor');
    logger.info(`Writing env file with the details: '${envFileOutputPath}'`);
    writeFileSync(envFileOutputPath, envFileStr, 'utf8');
    logger.log(`Wrote '${envFileOutputPath}' successfully.`);
}

async function deploy() {
    // Gather keys
    const deployerAccount = deployerKey.toPublicKey();
    const zkAppAddress = zkAppPrivateKey.toPublicKey();
    const zkAppAddressBase58 = zkAppAddress.toBase58();
    logger.log(`Deployer address: '${deployerAccount.toBase58()}'.`);
    logger.log(`ZkApp contract address: '${zkAppAddressBase58}'.`);

    // Configure Mina network
    const Network = Mina.Network({
        networkId: 'testnet' as NetworkId,
        mina: networkUrl,
    });
    Mina.setActiveInstance(Network);

    // Compile and verify
    const { ethProcessorVerificationKey } = await compileAndVerifyContracts(
        logger,
        [
            {
                name: 'ethVerifier',
                program: EthVerifier,
                integrityHash: ethVerifierVkHash,
            },
            {
                name: 'ethProcessor',
                program: EthProcessor,
                integrityHash: ethProcessorVkHash,
            },
        ]
    );

    // Initialize contract
    const zkApp = new EthProcessor(zkAppAddress);

    // Deploy transaction
    let snippet = !zkAppPrivateKeyWasCreated ? 're-' : '';
    logger.log(`Creating ${snippet}deployment transaction...`);
    const txn = await Mina.transaction(
        { fee, sender: deployerAccount },
        async () => {
            snippet = !zkAppPrivateKeyWasCreated ? ' an updated' : '';
            logger.log(
                `Deploying smart contract with${snippet} verification key hash: '${ethProcessorVerificationKey.hash}'`
            );

            if (zkAppPrivateKeyWasCreated) {
                AccountUpdate.fundNewAccount(deployerAccount);
                await zkApp.deploy({
                    verificationKey: ethProcessorVerificationKey,
                });
                logger.log(
                    `Initializing with adminPublicKey '${adminPublicKey.toBase58()}' and store hash '${possibleStoreHash.toHex()}'.`
                );
                await zkApp.initialize(
                    adminPublicKey,
                    Bytes32FieldPair.fromBytes32(possibleStoreHash)
                );
            } else {
                await zkApp.setVerificationKey(ethProcessorVerificationKey);
            }
        }
    );

    logger.log('Proving transaction');
    await txn.prove();
    const signedTx = txn.sign([deployerKey, zkAppPrivateKey]);
    logger.log('Sending transaction...');
    const pendingTx = await signedTx.send();
    logger.log('Waiting for transaction to be included in a block...');
    await pendingTx.wait();

    await fetchAccount({ publicKey: zkAppAddress });
    const currentAdmin = await zkApp.admin.fetch();
    logger.log('Deployment successful!');
    logger.log(`Contract admin: '${currentAdmin?.toBase58()}'.`);

    if (zkAppPrivateKeyWasCreated)
        writeSuccessDetailsToEnvFileFile(zkAppAddressBase58);
}

// Execute deployment
deploy().catch((err) => {
    logger.fatal(`Deploy function encountered an error.\n${String(err)}`);
    process.exit(1);
});
