import {  CircuitString, Poseidon, PrivateKey, Signature, ZkProgram, Field,PublicKey, Struct, Provable } from "o1js";
const outputType = Struct({
    hash: Field,
    key: PublicKey
});

const SignatureMessage = Provable.Array(Field, 128);
//type x = typeof SignatureMessage;
//const y = {} as unknown as x;
//y.
const SigToHash = ZkProgram({
    name: "SigToHash",
    publicOutput: outputType,
    methods: {
        compute: {
            privateInputs: [Signature, PublicKey, SignatureMessage],
            async method(input: Signature, pubKey: PublicKey, msg: Field[]) {
                const hash = Poseidon.hash(input.toFields());
                input.verify(pubKey, msg).assertTrue();
                const publicOutput = {
                    hash,
                    key: pubKey
                }
                return { publicOutput };
            }
        }
    }
})

describe('Signature to hash', () => {
    it('Testing going from a signatue to a hash', async ()=>{
        const priKey = PrivateKey.random();
        const msg = 'NoriZK';
        const cs = CircuitString.fromString(msg);
        const csFields = cs.values.map((char) => char.toField());
        const signature = Signature.create(priKey, csFields);
        const hash = Poseidon.hash(signature.toFields());
        console.log('Hash of mina signature of chars', hash.toString());
    });

    it('ZKProgram of sig to hash', async () => {
        const priKey = PrivateKey.random();
        const publicKey = priKey.toPublicKey();
        const msg = 'NoriZK';
        const cs = CircuitString.fromString(msg);
        const csFields = cs.values.map((char) => char.toField());
        const signature = Signature.create(priKey, csFields);
        const hash = Poseidon.hash(signature.toFields());
        console.log('Non provable hash', hash.toString());
        const {verificationKey} = await SigToHash.compile();
        console.log('Compiled zk program', verificationKey.hash.toString());
        console.log('csFields', csFields.length);
        const proof = await SigToHash.compute(signature, publicKey, csFields);
        console.log('Computed proof', proof.proof.publicOutput.hash.toString());
        await proof.proof.verify();
        console.log('Verified proof');
    });
});