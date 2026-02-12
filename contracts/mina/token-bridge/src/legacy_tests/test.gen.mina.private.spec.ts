import { Logger, LogPrinter } from 'esm-iso-logger';
import { PrivateKey } from "o1js";

new LogPrinter('TestEthProcessor');
const logger = new Logger('TestGenMinaPrivateSpec');

describe('gen_mina_pk', () => {
    test('gen_mina_pk', async () => {
        const pk = PrivateKey.random();
        logger.log('prk', pk.toBase58());
        logger.log('pubk', pk.toPublicKey().toBase58());
    })
});