import { Logger, LogPrinter } from 'esm-iso-logger';
import { decodeConsensusMptProof } from './utils.js';
import { sp1ConsensusMPTPlonkProof } from './test-examples/sp1-mpt-proof/sp1ProofMessage.js';
import { Bool, Field, Provable, UInt8 } from 'o1js';
import { wordToBytes } from '@nori-zk/proof-conversion/min';

new LogPrinter('TestO1jsZkUtils');
const logger = new Logger('UtilsSpec');

describe('ConsensusMPT marshaller Integration Test', () => {
    test('should decode consensus mpt transition proof', async () => {
        const decodedProof = decodeConsensusMptProof(
            sp1ConsensusMPTPlonkProof.proof
        );
        logger.log('decodedProof', decodedProof);
    });

    test('Field order wrapping bytes 32 validation', () => {
        /*
            In LE byte representation, bytes are ordered from least significant to most significant:
            bytes[0] = least significant byte (contributes 256^0)
            ...
            bytes[31] = most significant byte (contributes 256^31)

            The field prime p in LE:
            [1,0,0,0,237,48,45,153,27,249,76,9,252,152,70,34,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,64]

            Guard byte alone (bytes[31] <= 64) is INSUFFICIENT:
            e.g. bytes[31]=64, bytes[16]=1 -> 64*256^31 + 1*256^16 > p, yet the guard passes.

            Correct approach: full lexicographic comparison from bytes[31] down to bytes[0].
            Field.lessThan() returns a provable Bool, Provable.if() selects between values.
        */

        // Mina field prime p in LE as Fields
        const P_LE: Field[] = [
            1n,
            0n,
            0n,
            0n,
            237n,
            48n,
            45n,
            153n,
            27n,
            249n,
            76n,
            9n,
            252n,
            152n,
            70n,
            34n,
            0n,
            0n,
            0n,
            0n,
            0n,
            0n,
            0n,
            0n,
            0n,
            0n,
            0n,
            0n,
            0n,
            0n,
            0n,
            64n,
        ].map((b) => new Field(b));

        function isLessThanFieldPrime(bytes: UInt8[]): Bool {
            let strictlyLess = Bool(false);
            let different = Bool(false);
            for (let i = 31; i >= 0; i--) {
                const pField = P_LE[i] as Field;
                const byteField = (bytes[i] as UInt8).value;
                const lt = byteField.lessThan(pField);
                const eq = byteField.equals(pField);
                strictlyLess = Provable.if(
                    different.not().and(lt),
                    Bool,
                    Bool(true),
                    strictlyLess
                );
                different = different.or(eq.not());
            }
            return strictlyLess;
        }

        // p - 1 (max valid field element) -> valid
        const maxValidBytes = wordToBytes(new Field(Field.ORDER - 1n), 32);
        logger.log(
            'p-1 LE bytes:',
            maxValidBytes.map((u) => u.toNumber())
        );
        expect(isLessThanFieldPrime(maxValidBytes).toBoolean()).toBe(true);

        // zero -> valid
        const zeroBytes = Array.from({ length: 32 }, () => UInt8.from(0));
        expect(isLessThanFieldPrime(zeroBytes).toBoolean()).toBe(true);

        // p itself -> invalid (wraps in Field but raw bytes exceed the prime)
        const pBytes = P_LE.map((f) => UInt8.from(f.toBigInt()));
        expect(isLessThanFieldPrime(pBytes).toBoolean()).toBe(false);

        // Guard byte passes but overflows: bytes[31]=64, bytes[16]=1 -> invalid
        const guardPassesButOverflows = Array.from({ length: 32 }, () =>
            UInt8.from(0)
        );
        guardPassesButOverflows[31] = UInt8.from(64);
        guardPassesButOverflows[16] = UInt8.from(1);
        expect(isLessThanFieldPrime(guardPassesButOverflows).toBoolean()).toBe(
            false
        );
    });
});
