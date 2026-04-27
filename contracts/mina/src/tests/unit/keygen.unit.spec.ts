import { PrivateKey } from 'o1js';
import { ethers } from 'ethers';

describe('Should generate key pair', () => {
    test('Should generate key pair', () => {
        const { privateKey, publicKey } = PrivateKey.randomKeypair();
        console.log(`privateKey: '${privateKey.toBase58()}'`);
        console.log(`publicKey: '${publicKey.toBase58()}'`);
    });

    test('Should generate 5 Mina + 5 Ethereum keys for loadRunner', () => {
        const count = 5;
        const minaKeys = Array.from({ length: count }, () =>
            PrivateKey.randomKeypair()
        );
        const ethWallets = Array.from({ length: count }, () =>
            ethers.Wallet.createRandom()
        );
        const labels = Array.from({ length: count }, (_, i) => `user${i}`);

        console.log('\n=== generated accounts ===');
        for (let i = 0; i < count; i++) {
            console.log(`\n[${labels[i]}]`);
            console.log(`  ETH  addr : ${ethWallets[i].address}`);
            console.log(`  ETH  priv : ${ethWallets[i].privateKey}`);
            console.log(`  MINA pub  : ${minaKeys[i].publicKey.toBase58()}`);
            console.log(`  MINA priv : ${minaKeys[i].privateKey.toBase58()}`);
        }

        const ethPrivs = ethWallets.map((w) => w.privateKey).join(',');
        const minaPrivs = minaKeys.map((k) => k.privateKey.toBase58()).join(',');
        const labelsCsv = labels.join(',');

        console.log('\n=== recommended loadRunner env ===');
        console.log(`LOAD_USER_LABELS=${labelsCsv}`);
        console.log(`LOAD_USER_ETH_PRIV_KEYS=${ethPrivs}`);
        console.log(`LOAD_USER_MINA_PRIV_KEYS=${minaPrivs}`);
        console.log('LOAD_LOCK_AMOUNTS_ETH=0.0001');
        console.log('LOAD_ETH_MIN_BALANCES=0.005');
        console.log('LOAD_MINA_MIN_BALANCES=2');
        console.log('LOAD_BASE_TICK_MINUTES=2');
        console.log('LOAD_MAX_CONCURRENT=2');
        console.log('LOAD_MAX_CONCURRENT_COMPILES=5');
        console.log('LOAD_PER_USER_COOLDOWN_MINUTES=5');
        console.log('LOAD_LOG_DIR=./logs/loadRunner');
        console.log('\nFund each ETH address on Sepolia and each MINA address on mesa-testnet before running.');
    });
});
