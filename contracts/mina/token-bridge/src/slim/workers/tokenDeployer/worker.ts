import { EthVerifier } from '@nori-zk/o1js-zk-utils';
import {
    AccountUpdate,
    Bool,
    Field,
    Mina,
    NetworkId,
    PrivateKey,
    PublicKey,
    UInt8,
} from 'o1js';
import {
    compileEcdsaEthereum,
    compileEcdsaSigPresentationVerifier,
} from '../../../credentialAttestation.js';
import { NoriTokenController } from '../../NoriTokenController.js';
import { NoriStorageInterface } from '../../NoriStorageInterface.js';
import { FungibleToken } from '../../TokenBase.js';
import { DeploymentResult } from '../../../NoriControllerSubmitter.js';

export class TokenDeployerWorker {
    // Mina setup ******************************************************************************

    async minaSetup(options: {
        networkId?: NetworkId;
        mina: string | string[];
        archive?: string | string[];
        lightnetAccountManager?: string;
        bypassTransactionLimits?: boolean;
        minaDefaultHeaders?: HeadersInit;
        archiveDefaultHeaders?: HeadersInit;
    }) {
        const Network = Mina.Network(options);
        Mina.setActiveInstance(Network);
    }

    async compile() {
        console.log('Compiling prerequisites...');

        console.time('EthVerifier compile');
        const { verificationKey: ethVerifierVerificationKey } =
            await EthVerifier.compile({
                forceRecompile: true,
            });
        console.timeEnd('EthVerifier compile');
        console.log(
            `EthVerifier compiled vk: '${ethVerifierVerificationKey.hash}'.`
        );

        // Compile programs / contracts
        console.time('compileEcdsaEthereum');
        await compileEcdsaEthereum();
        console.timeEnd('compileEcdsaEthereum'); // 1:20.330 (m:ss.mmm)

        console.time('compilePresentationVerifier');
        await compileEcdsaSigPresentationVerifier();
        console.timeEnd('compilePresentationVerifier'); // 11.507s

        console.log('Compiling contracts...');
        // Compile all required contracts
        console.time('NoriStorageInterface compile');
        const { verificationKey: storageInterfaceVerificationKey } =
            await NoriStorageInterface.compile({ forceRecompile: true });
        console.timeEnd('NoriStorageInterface compile');
        console.log(
            `NoriStorageInterface compiled vk: '${storageInterfaceVerificationKey.hash}'.`
        );

        console.time('FungibleToken compile');
        const { verificationKey: tokenBaseVerificationKey } =
            await FungibleToken.compile({ forceRecompile: true });
        console.timeEnd('FungibleToken compile');
        console.log(
            `FungibleToken compiled vk: '${tokenBaseVerificationKey.hash}'.`
        );

        console.time('NoriTokenController compile');
        const { verificationKey: noriTokenControllerVerificationKey } =
            await NoriTokenController.compile({ forceRecompile: true });
        console.timeEnd('NoriTokenController compile');
        console.log(
            `NoriTokenController compiled vk: '${noriTokenControllerVerificationKey.hash}'.`
        );

        const noriStorageInterfaceVerificationKeyHashField =
            storageInterfaceVerificationKey.hash;
        const noriStorageInterfaceVerificationKeyHashBigInt =
            noriStorageInterfaceVerificationKeyHashField.toBigInt();
        const noriStorageInterfaceVerificationKeyHashStr =
            noriStorageInterfaceVerificationKeyHashBigInt.toString();

        return {
            data: storageInterfaceVerificationKey.data,
            hashStr: noriStorageInterfaceVerificationKeyHashStr,
        };
    }

    async deployContracts(
        senderPrivateKeyBase58: string,
        adminPrivateKeyBase58: string,
        tokenControllerPrivateKeyBase58: string,
        tokenBasePrivateKeyBase58: string,
        ethProcessorAddressBase58: string,
        storageInterfaceVerificationKeySafe: {
            data: string;
            hashStr: string;
        },
        txFee: number,
        options: {
            symbol?: string;
            decimals?: number;
            allowUpdates?: boolean;
            startPaused?: boolean;
        } = {}
    ): Promise<DeploymentResult> {
        const { hashStr: storageInterfaceVerificationKeyHashStr, data } =
            storageInterfaceVerificationKeySafe;
        const storageInterfaceVerificationKeyHashBigInt = BigInt(
            storageInterfaceVerificationKeyHashStr
        );
        const hash = new Field(storageInterfaceVerificationKeyHashBigInt);
        const storageInterfaceVerificationKey = { data, hash };
        console.log('adminPrivateKeyBase58', !!adminPrivateKeyBase58);
        const adminPrivateKey = PrivateKey.fromBase58(adminPrivateKeyBase58);
        const adminPublicKey = adminPrivateKey.toPublicKey();
        console.log('senderPrivateKeyBase58', !!senderPrivateKeyBase58);
        const senderPrivateKey = PrivateKey.fromBase58(senderPrivateKeyBase58);

        const ethProcessorAddress = PublicKey.fromBase58(
            ethProcessorAddressBase58
        );

        console.log('Deploying NoriTokenController and TokenBase contracts...');

        const symbol = options.symbol || 'nETH';
        const decimals = UInt8.from(options.decimals || 18);
        const allowUpdates = options.allowUpdates ?? true;
        const startPaused = Bool(options.startPaused ?? false);

        
        const senderPublicKey = senderPrivateKey.toPublicKey();

        const noriTokenControllerPrivateKey = PrivateKey.fromBase58(
            tokenControllerPrivateKeyBase58
        );
        const noriTokenControllerPublicKey =
            noriTokenControllerPrivateKey.toPublicKey();

        const tokenBasePrivateKey = PrivateKey.fromBase58(
            tokenBasePrivateKeyBase58
        );
        const tokenBaseAddress = tokenBasePrivateKey.toPublicKey();

        const noriTokenController = new NoriTokenController(
            noriTokenControllerPublicKey
        );
        const tokenBase = new FungibleToken(tokenBaseAddress);

        const deployTx = await Mina.transaction(
            { sender: senderPublicKey, fee: txFee },
            async () => {
                AccountUpdate.fundNewAccount(senderPublicKey, 3);

                // Deploy NoriTokenController
                await noriTokenController.deploy({
                    adminPublicKey: adminPublicKey,
                    tokenBaseAddress: tokenBaseAddress,
                    storageVKHash: storageInterfaceVerificationKey.hash,
                    ethProcessorAddress,
                });

                // Deploy TokenBase
                await tokenBase.deploy({
                    symbol,
                    src: 'https://nori',
                    allowUpdates,
                });

                // Initialize TokenBase
                await tokenBase.initialize(
                    tokenBaseAddress,
                    decimals,
                    startPaused
                );
            }
        );

        console.log('Deploy transaction created. Proving...');
        await deployTx.prove();

        console.log('Transaction proved. Signing and sending...');
        const tx = await deployTx
            .sign([
                senderPrivateKey,
                noriTokenControllerPrivateKey,
                tokenBasePrivateKey,
            ])
            .send();

        const result = await tx.wait();

        console.log('Contracts deployed successfully');

        return {
            noriTokenControllerAddress: noriTokenController.address.toBase58(),
            tokenBaseAddress: tokenBase.address.toBase58(),
            txHash: result.hash,
        };
    }
}
