import { PrivateKey } from 'o1js';

describe('Should generate key pair', () => {
    test('Should generate key pair', () => {
        const { privateKey, publicKey } = PrivateKey.randomKeypair();
        console.log(`privateKey: '${privateKey.toBase58()}'`);
        console.log(`publicKey: '${publicKey.toBase58()}'`);
    });
});
