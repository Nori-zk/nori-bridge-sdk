import 'dotenv/config';
import { fieldToHexBE } from '@nori-zk/o1js-zk-utils';
import { validateEnv } from './testUtils.js';
import { ethers } from 'ethers';
import { signSecretWithEthWallet } from './ethSignature.js';
import {
    createCodeChallenge,
    obtainCodeVerifierFromEthSignature,
} from './pkarm.js';
import { PrivateKey } from 'o1js';

test('get_wallet_address_and_code_challenge_hex', async () => {
    const { ethPrivateKey, ethRpcUrl, minaSenderPrivateKeyBase58 } =
        validateEnv();
    const etherProvider = new ethers.JsonRpcProvider(ethRpcUrl);
    const ethWallet = new ethers.Wallet(ethPrivateKey, etherProvider);
    const ethAddressLowerHex = ethWallet.address.toLowerCase();
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
    console.log('ethAddressHex', ethWallet.address);
    console.log('codeChallengePKARMBEHex', hex);
});
