// As opposed to using the provable method we can update a VK directly via a dedicated transaction

// Load environment variables from .env file
import 'dotenv/config';
import { Mina, AccountUpdate, fetchAccount, PrivateKey } from 'o1js';
import { Logger, LogPrinter } from 'esm-iso-logger';
import { type VerificationKeySafe, vkSafeToVk } from '@nori-zk/o1js-zk-utils';
import noriTokenBridgeVkData from '../integrity/NoriTokenBridge.VkData.json' with { type: 'json' };
import noriTokenBridgeVkHashStr from '../integrity/NoriTokenBridge.VkHash.json' with { type: 'json' };
import noriFungibleTokenVkData from '../integrity/FungibleToken.VkData.json' with { type: 'json' };
import noriFungibleTokenVkHashStr from '../integrity/FungibleToken.VkHash.json' with { type: 'json' };
import { parseAdminBinEnv, setupNetworkAndCompile } from './utils/adminBinUtils.js';

const logger = new Logger('UpdateVkNonProvable');

new LogPrinter('NoriTokenBridge');

const config = parseAdminBinEnv(logger, 'UpdateVkNonProvable');

const tokenBaseKeyBase58 = process.env.NORI_MINA_TOKEN_BASE_PRIVATE_KEY;
if (!tokenBaseKeyBase58) {
    logger.fatal('Missing required env: NORI_MINA_TOKEN_BASE_PRIVATE_KEY');
    process.exit(1);
}


const vkSafe: VerificationKeySafe = {
    data: noriTokenBridgeVkData as string,
    hashStr: noriTokenBridgeVkHashStr as string,
};
const newVerificationKey = vkSafeToVk(vkSafe);

const vkSafeTokenBase: VerificationKeySafe = {
    data: noriFungibleTokenVkData as string,
    hashStr: noriFungibleTokenVkHashStr as string,
};
const newTokenBaseVerificationKey = vkSafeToVk(vkSafeTokenBase);

logger.log(`New VK hash: '${vkSafe.hashStr}'`);
logger.log(`VkData file: 'src/integrity/NoriTokenBridge.VkData.json'`);
logger.log(`VkHash file: 'src/integrity/NoriTokenBridge.VkHash.json'`);

async function updateVkNonProvable() {
    const _ = await setupNetworkAndCompile(logger, config);
    const tokenBridgeAddress = config.tokenBridgePrivateKey.toPublicKey();

    const tokenBasePrivateKey = PrivateKey.fromBase58(tokenBaseKeyBase58);
    const tokenBaseAddress = tokenBasePrivateKey.toPublicKey();

    // `AccountUpdate.createSigned` sets `incrementNonce` plus a matching nonce
    // precondition for any account that isn't the fee payer. That nonce is read
    // via `getAccountPreconditions`, which silently falls back to zero when the
    // account isn't in o1js' fetch cache. o1js' two-pass "fetch missing data"
    // machinery does not cover this case (the precondition read short-circuits
    // on `Mina.hasAccount`, so the account is never marked to be fetched), so we
    // must fetch these accounts ourselves or the tx fails on-chain with
    // Account_nonce_precondition_unsatisfied.
    logger.log('Fetching accounts to resolve their current nonces...');
    for (const [name, publicKey] of [
        ['NoriTokenBridge', tokenBridgeAddress],
        ['FungibleToken (token base)', tokenBaseAddress],
    ] as const) {
        const { account, error } = await fetchAccount({ publicKey });
        if (!account) {
            throw new Error(
                `Could not fetch ${name} account '${publicKey.toBase58()}': ${String(error)}`
            );
        }
        logger.log(`${name} nonce: '${account.nonce.toString()}'.`);
    }

    logger.log('Creating non-provable update VK transaction...');
    const txn = await Mina.transaction(
        { fee: config.fee, sender: config.adminKey.toPublicKey() },
        async () => {
            logger.log(
                `Setting new verification key with hash: '${vkSafe.hashStr}'`
            );
            const bridgeAC = AccountUpdate.createSigned(tokenBridgeAddress);
            bridgeAC.account.verificationKey.set(newVerificationKey);
            logger.log(
                `Setting new tokenbase verification key with hash: '${vkSafeTokenBase.hashStr}'`
            );
            const tokenBaseAC = AccountUpdate.createSigned(tokenBaseAddress);
            tokenBaseAC.account.verificationKey.set(newTokenBaseVerificationKey);


            // tokenBridge.approve(ac);
        }
    );

    const signedTx = txn.sign([config.adminKey, config.tokenBridgePrivateKey, tokenBasePrivateKey]);
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
