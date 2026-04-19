// Shared utilities for admin bin scripts that follow the
// validate → compile → transact → wait pattern.

import { Mina, PrivateKey, type NetworkId, fetchAccount } from 'o1js';
import type { Logger } from 'esm-iso-logger';
import { NoriTokenBridge } from '../NoriTokenBridge.js';
import { NoriStorageInterface } from '../NoriStorageInterface.js';
import { FungibleToken } from '../TokenBase.js';
import { compileAndVerifyContracts } from '@nori-zk/o1js-zk-utils-new';
import { noriTokenBridgeVkHash } from '../integrity/NoriTokenBridge.VkHash.js';
import { noriStorageInterfaceVkHash } from '../integrity/NoriStorageInterface.VkHash.js';
import { fungibleTokenVkHash } from '../integrity/FungibleToken.VkHash.js';

export type AdminBinConfig = {
    adminKey: PrivateKey;
    tokenBridgePrivateKey: PrivateKey;
    networkUrl: string;
    networkId: NetworkId;
    fee: number;
};

/**
 * Parse and validate the env vars common to all admin bin scripts.
 * `extraValidations` is called to collect script-specific issues.
 * Exits the process if any issues are found.
 */
export function parseAdminBinEnv(
    logger: Logger,
    scriptName: string,
    extraValidations?: (issues: string[]) => void
): AdminBinConfig {
    const possibleNetworkUrl = process.env.MINA_RPC_NETWORK_URL;
    const possibleNetwork = process.env.MINA_NETWORK;
    const possibleAdminKeyBase58 = process.env.MINA_SENDER_PRIVATE_KEY;
    const possibleTokenBridgeKeyBase58 = process.env.NORI_MINA_TOKEN_BRIDGE_PRIVATE_KEY;
    const fee = Number(process.env.MINA_TX_FEE || 0.1) * 1e9;

    const issues: string[] = [];

    if (!possibleNetworkUrl)
        issues.push('Missing required env: MINA_RPC_NETWORK_URL');
    if (!possibleNetwork) issues.push('Missing required env: MINA_NETWORK');
    if (!possibleAdminKeyBase58)
        issues.push('Missing required env: MINA_SENDER_PRIVATE_KEY (must be the contract admin private key)');
    if (!possibleTokenBridgeKeyBase58)
        issues.push('Missing required env: NORI_MINA_TOKEN_BRIDGE_PRIVATE_KEY');

    let possibleAdminKey: PrivateKey | undefined;
    if (possibleAdminKeyBase58) {
        try {
            possibleAdminKey = PrivateKey.fromBase58(possibleAdminKeyBase58);
        } catch (e) {
            issues.push(
                `MINA_SENDER_PRIVATE_KEY (contract admin) is not a valid private key: ${(e as Error).message}`
            );
        }
    }

    let possibleTokenBridgeKey: PrivateKey | undefined;
    if (possibleTokenBridgeKeyBase58) {
        try {
            possibleTokenBridgeKey = PrivateKey.fromBase58(possibleTokenBridgeKeyBase58);
        } catch (e) {
            issues.push(
                `NORI_MINA_TOKEN_BRIDGE_PRIVATE_KEY is not a valid private key: ${(e as Error).message}`
            );
        }
    }

    extraValidations?.(issues);

    if (issues.length) {
        const formatted = [
            `${scriptName} encountered issues:`,
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

    if (
        possibleAdminKey === undefined ||
        possibleTokenBridgeKey === undefined ||
        possibleNetworkUrl === undefined ||
        possibleNetwork === undefined
    ) {
        logger.fatal('Internal error: required values undefined after validation.');
        process.exit(1);
    }

    return {
        adminKey: possibleAdminKey,
        tokenBridgePrivateKey: possibleTokenBridgeKey,
        networkUrl: possibleNetworkUrl,
        networkId: possibleNetwork === 'mainnet' ? 'mainnet' : 'testnet',
        fee,
    };
}

/**
 * Set up the Mina network, compile contracts, and return a NoriTokenBridge
 * instance bound to the token bridge address.
 */
export async function setupNetworkAndCompile(
    logger: Logger,
    config: AdminBinConfig
): Promise<NoriTokenBridge> {
    const tokenBridgeAddress = config.tokenBridgePrivateKey.toPublicKey();
    const adminAccount = config.adminKey.toPublicKey();
    logger.log(`Admin address: '${adminAccount.toBase58()}'.`);
    logger.log(`NoriTokenBridge address: '${tokenBridgeAddress.toBase58()}'.`);

    const Network = Mina.Network({ networkId: config.networkId, mina: config.networkUrl });
    Mina.setActiveInstance(Network);

    await compileAndVerifyContracts(logger, [
        {
            name: 'NoriStorageInterface',
            program: NoriStorageInterface,
            integrityHash: noriStorageInterfaceVkHash,
        },
        {
            name: 'FungibleToken',
            program: FungibleToken,
            integrityHash: fungibleTokenVkHash,
        },
        {
            name: 'NoriTokenBridge',
            program: NoriTokenBridge,
            integrityHash: noriTokenBridgeVkHash,
        },
    ]);

    return new NoriTokenBridge(tokenBridgeAddress);
}

/**
 * Build, prove, sign, send, and wait for an admin transaction.
 */
export async function submitAdminTx(
    logger: Logger,
    config: AdminBinConfig,
    txBody: () => Promise<void>
): Promise<void> {
    const adminAccount = config.adminKey.toPublicKey();
    const tokenBridgeAddress = config.tokenBridgePrivateKey.toPublicKey();

    const txn = await Mina.transaction(
        { fee: config.fee, sender: adminAccount },
        txBody
    );

    logger.log('Proving transaction');
    await txn.prove();
    const signedTx = txn.sign([config.adminKey]);
    logger.log('Sending transaction...');
    const pendingTx = await signedTx.send();
    logger.log('Waiting for transaction to be included in a block...');
    await pendingTx.wait();

    await fetchAccount({ publicKey: tokenBridgeAddress });
}
