import { id, Wallet } from 'ethers';
import { EcdsaEthereum } from 'mina-attestations/imported';
import { Bytes, declareMethods, Field, PublicKey, SmartContract } from 'o1js';
import {
    Credential,
    DynamicBytes,
    Operation,
    Presentation,
    PresentationRequest,
    PresentationSpec,
} from 'mina-attestations';

type CharArray<S extends string> = S extends `${infer First}${infer Rest}`
    ? [First, ...CharArray<Rest>]
    : [];

type CountChars<S extends string> = CharArray<S>['length'];

type LengthMismatchError<Expected extends number> = {
    expectedLength: Expected;
};

type EnforceLength<S extends string, N extends number> = CountChars<S> extends N
    ? S
    : LengthMismatchError<N>;

const secretLength = 20 as const;
type SecretLength = typeof secretLength;

// FIXME probably should have variable length no more than 20 rather than fixed length 20 but need to test it works like that .... wait for the unit tests

// Fixed length secret credential.

export const EcdsaCredential = await EcdsaEthereum.Credential({
    maxMessageLength: secretLength, // maxMessageLength is a misnomer by mina-attestations
});

let credentialPresentationSpec = PresentationSpec(
    { credential: EcdsaCredential.spec },
    ({ credential }) => ({
        outputClaim: Operation.record({
            owner: Operation.owner, // Mina
            issuer: Operation.issuerPublicKey({
                credentialType: credential.credentialType,
                credentialKey: credential.credentialKey,
                type: credential.type,
            }), // Eth
            messageHash: Operation.hash(
                Operation.property(credential, 'message')
            ),
        }),
    })
);
let PresentationSpectPreCompile = await Presentation.precompile(
    credentialPresentationSpec
);

class ProvablePresentation extends PresentationSpectPreCompile.ProvablePresentation {}

class PresentationVerifier extends SmartContract {
    async verifyPresentation(presentation: ProvablePresentation) {
        // verify the presentation, and receive its claims for further validation and usage
        let { claims, outputClaim } = presentation.verify({
            publicKey: this.address,
            tokenId: this.tokenId,
            methodName: 'verifyPresentation',
        });
    }
}

declareMethods(PresentationVerifier, {
    verifyPresentation: [ProvablePresentation as any], // TODO bad TS interface
});

// Compile functions

export async function compileEcdsaEthereum() {
    await EcdsaEthereum.compileDependencies({
        maxMessageLength: secretLength, // maxMessageLength is a misnomer by mina-attestations
        proofsEnabled: true,
    });

    await EcdsaCredential.compile({ proofsEnabled: true });
}

export async function compilePresentationVerifier() {
    await PresentationVerifier.compile();
}

// Methods

async function getCredential<FixedString extends string>(
    ethWallet: Wallet,
    minaPubKey: PublicKey,
    secret: EnforceLength<FixedString, SecretLength>
) {
    const maxMessageLength = 32;
    const Message = DynamicBytes({ maxLength: maxMessageLength });

    // Create signature
    let message = secret as string;
    const parseHex = (hex: string) => Bytes.fromHex(hex.slice(2)).toBytes();
    const hashMessage = (msg: string) => parseHex(id(msg));
    let sig = await ethWallet.signMessage(hashMessage(message));

    // create credential (which verifies the signature)
    let { signature, parityBit } = EcdsaEthereum.parseSignature(sig);

    let credential = await EcdsaCredential.create({
        owner: minaPubKey,
        publicInput: {
            signerAddress: EcdsaEthereum.parseAddress(ethWallet.address),
        },
        privateInput: {
            message: Message.fromString(message),
            signature,
            parityBit,
        },
    });

    const credentialJson = Credential.toJSON(credential);
    return credentialJson;
}

async function getPresentationRequest(
    credentialJson: string,
    zkAppAddress: PublicKey
) {
    let credential = await Credential.fromJSON(credentialJson);
    await Credential.validate(credential);

    // ZKAPP VERIFIER, outside circuit: request a presentation

    let request = PresentationRequest.zkAppFromCompiled(
        PresentationSpectPreCompile,
        {}, // createdAt: UInt64.from(Date.now())
        {
            // this added context ensures that the presentation can't be used outside the target zkApp
            publicKey: zkAppAddress,
            tokenId: new Field(0),
            methodName: 'verifyPresentation',
        }
    );
    let requestJson = PresentationRequest.toJSON(request);

    console.log(
        '✅ VERIFIER: created presentation request:',
        requestJson.slice(0, 500) + '...'
    );

    return requestJson;
}

async function verifyPresentation(serializedPresentationRequest: string, zkAppAddress: PublicKey) {
    let presentation = Presentation.fromJSON(serializedPresentationRequest);
    new PresentationVerifier(zkAppAddress).verifyPresentation(
        ProvablePresentation.from(presentation)
    );
}
