import { Logger, LogPrinter } from 'esm-iso-logger';
import { decodeConsensusMptProof } from './utils.js';
import { sp1ConsensusMPTPlonkProof } from './test-examples/sp1-mpt-proof/sp1ProofMessage.js';
import { Field, UInt8 } from 'o1js';
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
        const maxFieldValue = new Field(Field.ORDER - 1n);
        const maxFieldValueBytes = wordToBytes(maxFieldValue, 32);
        // Point being that the 'last' not sure if first or last has a particular value and if we are bigger than that
        // Then the input value was void because it is bigger than the prime modulus for its 32 bytes storage
        /*

        In LE byte representation, bytes are ordered from least significant to most significant:
        bytes[0] = least significant byte (contributes 256^0)
        bytes[1] = next (contributes 256^1)
        ...
        bytes[31] = most significant byte (contributes 256^31)

        The field order is the prime P for which we wrap
        So the value range is 0 -> Field.ORDER - 1

        The field is approx ~31.75 bytes
        We know that 31 of the bytes (bytes[0]->bytes[30]) could all be max values and this would
        STILL not overflow the prime modulus

        */

        // Derive the guard byte from the max valid field element
        const guardByte = maxFieldValueBytes[31];
        logger.log(`Guard byte bytes[31]: ${guardByte.toBigInt()}`);

        // Field.ORDER wraps to 0 — guard byte becomes 0, proving the boundary
        const wrappedBytes = wordToBytes(new Field(Field.ORDER), 32);
        expect(wrappedBytes[31].toBigInt()).toBe(0n);

        // Guard byte of max valid is greater than the wrapped (proving it sits at the boundary)
        expect(guardByte.toBigInt()).toBeGreaterThan(0n);

         // Construct an invalid UInt8[] — bytes[31] exceeds the guard by 1
        const invalidBytes = Array.from({ length: 32 }, () => UInt8.from(0));
        invalidBytes[31] = UInt8.from(guardByte.toBigInt() + 1n);

        // The guard rejects invalid bytes — assertLessThanOrEqual throws when bytes[31] > guardByte
        expect(() => invalidBytes[31].value.assertLessThanOrEqual(guardByte.value)).toThrow();

        // Inline Horner's method to convert back to Field
        let result = new Field(0);
        for (let i = 31; i >= 0; i--) {
            result = result.mul(256).add(invalidBytes[i].value);
        }

        // Result wrapped — despite bytes[31] being larger, the Field value is smaller than max valid
        expect(result.toBigInt()).toBeLessThan(maxFieldValue.toBigInt());
    });
});
