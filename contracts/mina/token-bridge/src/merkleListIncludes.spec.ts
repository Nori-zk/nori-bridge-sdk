import {
    Bool,
    Field,
    Int64,
    MerkleList,
    Provable,
    Sign,
    Struct,
    UInt64,
    ZkProgram,
} from 'o1js';

class FieldList extends MerkleList.create(Field) {}

class MerkleListAttestorInput extends Struct({
    list: FieldList,
    item: Field,
}) {}

class MerkleListAttestorOutput extends Struct({
    found: Bool,
    //index: Int64,
}) {}

const MerkleListLeafAttestor = ZkProgram({
    name: 'MerkleListAttestor',
    publicInput: MerkleListAttestorInput,
    publicOutput: MerkleListAttestorOutput,
    methods: {
        attest: {
            privateInputs: [],
            async method(input: MerkleListAttestorInput) {
                // Start with a false Bool
                let inList: Bool = new Bool(false);
                /*let foundIndex: Int64 = Int64.create(
                    UInt64.from(1),
                    Sign.minusOne
                );*/

                // Iterate through the list
                input.list.forEach(1000, (element, isDummy, index) => {
                    // Only consider non-dummy elements
                    const check = Provable.if(
                        isDummy,
                        new Bool(false),
                        element.equals(input.item)
                    );
                    // Combine with previous result immutably
                    inList = Provable.if(check, new Bool(true), inList);
                    /*foundIndex = Provable.if(
                        check.and(inList.not()),
                        Int64.create(UInt64.from(index), Sign.one),
                        foundIndex
                    );*/
                });

                return {
                    publicOutput: new MerkleListAttestorOutput({
                        found: inList,
                        //index: foundIndex,
                    }),
                };
            },
        },
    },
});

it('entry_exist_in_list_of_1000', async () => {
    // Create a FieldList with 1000 elements
    const elements: Field[] = [];
    for (let i = 0; i < 500; i++) {
        elements.push(Field(i));
    }

    const list = FieldList.from(elements);

    const input = new MerkleListAttestorInput({
        list,
        item: Field(5000), // pick an existing element
    });

    const analysis = await MerkleListLeafAttestor.analyzeMethods();
    console.log('attest gates', analysis['attest'].gates.length);
    await MerkleListLeafAttestor.compile();

    const result = await MerkleListLeafAttestor.attest(input);
    console.log('found ',result.proof.publicOutput.found.toBoolean());
    //console.log('index ',result.proof.publicOutput.index.toBigint());
});
