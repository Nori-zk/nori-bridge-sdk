import 'dotenv/config';
import { Logger, LogPrinter } from 'esm-iso-logger';
import { fieldToHexBE } from '@nori-zk/o1js-zk-utils-new';
import { validateEnv } from '../testUtils.js';
import { ethers } from 'ethers';
import { signSecretWithEthWallet } from '../ethSignature.js';
import {
    createCodeChallenge,
    obtainCodeVerifierFromEthSignature,
} from '../pkarm.js';
import { PrivateKey } from 'o1js';

new LogPrinter('TestTokenBridge');
const logger = new Logger('EthMapValuesSpec');

test('get_wallet_address_and_code_challenge_hex', async () => {
    const { ethPrivateKey, ethRpcUrl, minaSenderPrivateKeyBase58 } =
        validateEnv();
    const etherProvider = new ethers.JsonRpcProvider(ethRpcUrl);
    const ethWallet = new ethers.Wallet(ethPrivateKey, etherProvider);
    //const ethAddressLowerHex = ethWallet.address.toLowerCase();
    const fixedValueOrSecret = 'NoriZK25';
    const ethSignatureSecret = await signSecretWithEthWallet(
        fixedValueOrSecret,
        ethWallet
    );
    const codeVerifierPKARMField =
        obtainCodeVerifierFromEthSignature(ethSignatureSecret); // This is a secret field
    const minaSenderPrivateKey = PrivateKey.fromBase58(
        minaSenderPrivateKeyBase58
    );
    const minaSenderPublicKey = minaSenderPrivateKey.toPublicKey();
    const codeChallengePKARMField = createCodeChallenge(
        codeVerifierPKARMField,
        minaSenderPublicKey
    );
    const hex = fieldToHexBE(codeChallengePKARMField);
    logger.log('ethAddressHex', ethWallet.address);
    logger.log('codeChallengePKARMBEHex', hex);
});
