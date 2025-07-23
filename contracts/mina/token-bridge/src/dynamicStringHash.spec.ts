import { DynamicString } from 'mina-attestations/dynamic';
import { Field, Poseidon, Provable, Struct, ZkProgram } from 'o1js';

const credString = DynamicString({ maxLength: 36_000 });

class InputType extends Struct({
    creds: credString
}) {
    
}
const testZk = ZkProgram({
    name: 'TestDynamicString',
    publicInput: InputType,
    publicOutput: Field,
    methods: {
        compute: {
            privateInputs: [],
            async method(input: InputType) {
                //let hash = input.creds.hash() as Field;


                let currentHash = new Field(0);
                input.creds.forEach((byte, dummy, index) => {
                    currentHash = Provable.if(dummy, currentHash, Poseidon.hash([currentHash, byte.value]));
                });

                currentHash.assertEquals(new Field(0));

                return {
                    publicOutput: new Field(0),
                };
            },
        },
    },
});

describe('Attestation proof hash test', () => {
    test('dynamicStringHash', async () => {
        await testZk.compile();
        const anaysis = await testZk.analyzeMethods();
        console.log('Gate',anaysis.compute.gates);
    });
});
