import { Bytes } from 'o1js';
import {
    type EnforceMaxLength,
    type SecretMaxLength,
} from './credentialAttestation.js';
import { id, Wallet } from 'ethers';

export async function signSecretWithEthWallet<FixedString extends string>(
    secret: EnforceMaxLength<FixedString, SecretMaxLength>,
    ethWallet: Wallet
) {
    const parseHex = (hex: string) => Bytes.fromHex(hex.slice(2)).toBytes();
    const hashMessage = (msg: string) => parseHex(id(msg));
    return await ethWallet.signMessage(hashMessage(secret as string));
}
