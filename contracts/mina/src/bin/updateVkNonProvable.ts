// As opposed to using the provable method we can update a VK directly via a dedicated transaction

// Load environment variables from .env file
import 'dotenv/config';
import { Mina, AccountUpdate, fetchAccount, PrivateKey, PublicKey } from 'o1js';
import { Logger, LogPrinter } from 'esm-iso-logger';
import { type VerificationKeySafe, vkSafeToVk } from '@nori-zk/o1js-zk-utils';
import noriTokenBridgeVkData from '../integrity/NoriTokenBridge.VkData.json' with { type: 'json' };
import noriTokenBridgeVkHashStr from '../integrity/NoriTokenBridge.VkHash.json' with { type: 'json' };
import { parseAdminBinEnv, setupNetworkAndCompile, submitAdminTx } from './utils/adminBinUtils.js';

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
    await fetchAccount({ publicKey: tokenBridgeAddress });
    await fetchAccount({ publicKey: config.adminKey.toPublicKey() });
    const adminOnChain = await tokenBridge.adminPublicKey.fetch()
    console.log('Admin on chain:', adminOnChain.toBase58())
    //   await fetchAccount({ publicKey: config.adminKey.toPublicKey() });
    logger.log('Creating non-provable update VK transaction...');
    const txn = await Mina.transaction(
        { fee: config.fee, sender: config.adminKey.toPublicKey() },
        async () => {
            logger.log(
                `Setting new verification key with hash: '${vkSafe.hashStr}'`
            );
            const update = AccountUpdate.createSigned(tokenBridgeAddress);
            update.account.verificationKey.set(newVerificationKey);
            // const ac = AccountUpdate.createSigned(tokenBridgeAddress);
            // AccountUpdate.setValue(
            //     ac.update.verificationKey,
            //     newVerificationKey
            // );
            // tokenBridge.approve(ac);
        }
    );

    const signedTx = await txn.sign([config.adminKey, config.tokenBridgePrivateKey, PrivateKey.fromBase58(process.env.NORI_MINA_TOKEN_BASE_PRIVATE_KEY)]).prove();
    // const signedTx = await txn.sign([PrivateKey.fromBase58('EKFXD7z5npsgNhTWogWYQ9tG2BkHe2PZdFE1U35oWvg4Mh4H1myg')]).prove();
    console.log('privkey admin', config.adminKey.toBase58())
    console.log('privkey token bridge', config.tokenBridgePrivateKey.toBase58())
    console.log('pubkey admin', config.adminKey.toPublicKey().toBase58())
    console.log('pubkey token bridge', config.tokenBridgePrivateKey.toPublicKey().toBase58())
    // await signedTx.prove();
    logger.log('Sending transaction...');
    const pendingTx = await signedTx.send();
    logger.log('Waiting for transaction to be included in a block...');
    await pendingTx.wait();

    await fetchAccount({ publicKey: tokenBridgeAddress });
    logger.log('Non-provable VK update successful!');

    // let txBody =
    //     async () => {
    //         logger.log(
    //             `Setting new verification key with hash: '${vkSafe.hashStr}'`
    //         );
    //         await tokenBridge.updateVerificationKey(newVerificationKey)
    //         // const update = AccountUpdate.createSigned(tokenBridgeAddress);
    //         // update.account.verificationKey.set(newVerificationKey);
    //         // const ac = AccountUpdate.createSigned(tokenBridgeAddress);
    //         // AccountUpdate.setValue(
    //         //     ac.update.verificationKey,
    //         //     newVerificationKey
    //         // );
    //         // tokenBridge.approve(ac);
    //     }
    // await submitAdminTx(logger, config, txBody)
}

updateVkNonProvable().catch((err) => {
    logger.fatal(
        `UpdateVkNonProvable function encountered an error.\n${String(err)}`
    );
    process.exit(1);
});
