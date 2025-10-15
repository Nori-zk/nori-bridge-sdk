import { PrivateKey } from "o1js";

describe('gen_mina_pk', () => {
    test('gen_mina_pk', async () => {
        const pk = PrivateKey.random();
        console.log('prk', pk.toBase58());
        console.log('pubk', pk.toPublicKey().toBase58());
    })
});