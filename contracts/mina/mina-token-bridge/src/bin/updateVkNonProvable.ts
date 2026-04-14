// As opposed to using the provable method we can update a VK directly via a dedicated transaction

// Load environment variables from .env file
import 'dotenv/config';
import { Mina, AccountUpdate, fetchAccount } from 'o1js';
import { Logger, LogPrinter } from 'esm-iso-logger';
import { type VerificationKeySafe, vkSafeToVk } from '@nori-zk/o1js-zk-utils-new';
import noriTokenBridgeVkData from '../integrity/NoriTokenBridge.VkData.json' with { type: 'json' };
import noriTokenBridgeVkHashStr from '../integrity/NoriTokenBridge.VkHash.json' with { type: 'json' };
import { parseAdminBinEnv, setupNetworkAndCompile } from './adminBinUtils.js';

const logger = new Logger('UpdateVkNonProvable');

new LogPrinter('NoriTokenBridge');

const config = parseAdminBinEnv(logger, 'UpdateVkNonProvable');

const vkSafe: VerificationKeySafe = {
    data: noriTokenBridgeVkData as string,
    hashStr: noriTokenBridgeVkHashStr as string,
};
const newVerificationKey = vkSafeToVk(vkSafe);

logger.log(`New VK hash: '${vkSafe.hashStr}'`);
logger.log(`VkData file: 'src/integrity/NoriTokenBridge.VkData.json'`);
logger.log(`VkHash file: 'src/integrity/NoriTokenBridge.VkHash.json'`);

async function updateVkNonProvable() {
    const tokenBridge = await setupNetworkAndCompile(logger, config);
    const tokenBridgeAddress = config.tokenBridgePrivateKey.toPublicKey();

    logger.log('Creating non-provable update VK transaction...');
    const txn = await Mina.transaction(
        { fee: config.fee, sender: config.adminKey.toPublicKey() },
        async () => {
            logger.log(
                `Setting new verification key with hash: '${vkSafe.hashStr}'`
            );
            const ac = AccountUpdate.createSigned(tokenBridgeAddress);
            AccountUpdate.setValue(
                ac.update.verificationKey,
                newVerificationKey
            );
            tokenBridge.approve(ac);
        }
    );

    const signedTx = txn.sign([config.adminKey, config.tokenBridgePrivateKey]);
    logger.log('Sending transaction...');
    const pendingTx = await signedTx.send();
    logger.log('Waiting for transaction to be included in a block...');
    await pendingTx.wait();

    await fetchAccount({ publicKey: tokenBridgeAddress });
    logger.log('Non-provable VK update successful!');
}

updateVkNonProvable().catch((err) => {
    logger.fatal(
        `UpdateVkNonProvable function encountered an error.\n${String(err)}`
    );
    process.exit(1);
});
