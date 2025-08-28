import { EcdsaEthereum } from 'mina-attestations/imported';
import {
    Cache,
    declareMethods,
    Field,
    PrivateKey,
    PublicKey,
    SmartContract,
} from 'o1js';
import {
    Credential,
    DynamicBytes,
    Operation,
    Presentation,
    PresentationRequest,
    PresentationSpec,
} from 'mina-attestations';
import { EnforceMaxLength, SecretMaxLength, secretMaxLength, SecretString } from './credentialAttestationUtils.js';

// Define EcdsaCredential type
console.log('Awaiting EcdsaCredential.Credential()');
console.time('EcdsaCredential.Credential() awaited');
export const EcdsaCredential = await EcdsaEthereum.Credential({
    maxMessageLength: secretMaxLength, // maxMessageLength is a misnomer by mina-attestations
});
console.timeEnd('EcdsaCredential.Credential() awaited');

// Define EcdsaCredentialPresentation Spec
let ecdsaCredentialPresentationSpec = PresentationSpec(
    // This does credential.verify() (we know its a valid credential, a wrapper around it)
    { credential: EcdsaCredential.spec },
    ({ credential }) => ({
        outputClaim: Operation.record({
            owner: Operation.owner, // Mina
            issuer: Operation.publicInput(credential), // Eth
            messageHash: Operation.hash(
                Operation.property(credential, 'message'),
                Operation.owner
            ),
        }),
    })
);

// Precompile ecdsaCredentialPresentationSpec
console.log('Compiling EcdsaSigPresentationSpecPreCompile');
console.time('EcdsaSigPresentationSpecPreCompile compile');
const EcdsaSigPresentationSpecPreCompile = await Presentation.precompile(
    ecdsaCredentialPresentationSpec
);
console.timeEnd('EcdsaSigPresentationSpecPreCompile compile');
console.log(
    `EcdsaSigPresentationSpecPreCompile compiled vk: '${EcdsaSigPresentationSpecPreCompile.verificationKey.hash}'.`
);

// Define ProvableEcdsaSigPresentation
export class ProvableEcdsaSigPresentation extends EcdsaSigPresentationSpecPreCompile.ProvablePresentation {}

// Define ProvableEcdsaSigPresentation verifier smart contract
export class EcdsaSigPresentationVerifier extends SmartContract {
    async verifyPresentation(presentation: ProvableEcdsaSigPresentation) {
        // verify the presentation, and receive its claims for further validation and usage
        let { outputClaim } = presentation.verify({
            publicKey: this.address,
            tokenId: this.tokenId,
            methodName: 'verifyPresentation',
        });

        return outputClaim;
    }
}

// o1js hackery
declareMethods(EcdsaSigPresentationVerifier, {
    verifyPresentation: [ProvableEcdsaSigPresentation as any], // TODO bad TS interface
});

// Compile util functions

// Compile EcdsaEthereum
export async function compileEcdsaEthereum(cache?: Cache) {
    /*const ecdsaEthereumOptions = {
        maxMessageLength: secretMaxLength, // maxMessageLength is a misnomer by mina-attestations
        proofsEnabled: true,
    } as {
        proofsEnabled: boolean;
        maxMessageLength: SecretMaxLength;
        cache?: Cache;
    };*/ // Note that cache does not really exist here FIXME!

    const ecdsaCredentialOptions = { proofsEnabled: true } as {
        proofsEnabled: boolean;
        cache?: Cache;
    };

    if (cache) {
        ecdsaCredentialOptions.cache = cache;
    }

    await EcdsaEthereum.compileDependencies({
        maxMessageLength: secretMaxLength, // maxMessageLength is a misnomer by mina-attestations
        proofsEnabled: true,
    });

    await EcdsaCredential.compile(ecdsaCredentialOptions);
}

// Compile EcdsaSigPresentationVerifier
export async function compileEcdsaSigPresentationVerifier(cache?: Cache) {
    await EcdsaSigPresentationVerifier.compile({ cache: cache });
}

// Methods

// Create EcdsaMinaCredential
export async function createEcdsaMinaCredential<FixedString extends string>(
    ethSignature: string,
    ethWalletAddress: string,
    minaPubKey: PublicKey,
    secret: EnforceMaxLength<FixedString, SecretMaxLength>
) {
    if ((secret as string).length > secretMaxLength)
        throw new Error(
            `Secret provided has length '${secret.valueOf}' which is greater than the max supported secret length '${secretMaxLength}'.`
        );

    const Message = DynamicBytes({ maxLength: secretMaxLength });

    const message = secret as string;

    // create credential (which verifies the signature)
    let { signature, parityBit } = EcdsaEthereum.parseSignature(ethSignature);

    let credential = await EcdsaCredential.create({
        owner: minaPubKey,
        publicInput: {
            signerAddress: EcdsaEthereum.parseAddress(ethWalletAddress),
        },
        privateInput: {
            message: Message.fromString(message),
            signature,
            parityBit,
        },
    });

    await Credential.validate(credential);

    const credentialJson = Credential.toJSON(credential);

    console.log('✅ Created credential:', credentialJson);

    return credentialJson;
}

// Create EcdsaSigPresentationRequest
export async function createEcdsaSigPresentationRequest(
    zkAppAddress: PublicKey
) {
    // ZKAPP VERIFIER, outside circuit: request a presentation

    let request = PresentationRequest.zkAppFromCompiled(
        EcdsaSigPresentationSpecPreCompile,
        {}, // createdAt: UInt64.from(Date.now())
        // TODO
        {
            // this added context ensures that the presentation can't be used outside the target zkApp
            publicKey: zkAppAddress,
            methodName: 'verifyPresentation',
            //tokenId: new Field(0), // Or TokenId.default() from o1js // Will need to be derived from the instance of the ZKApps we have TokenController contract
            //network // mainnet devnet
        }
    );
    let presentationRequestJson = PresentationRequest.toJSON(request);

    console.log('✅ Created presentation request:', presentationRequestJson);

    return presentationRequestJson;
}

// Create EcdsaSigPresentation
export async function createEcdsaSigPresentation(
    presentationRequestJson: string,
    credentialJson: string,
    owner: PrivateKey
) {
    const presentationRequest = PresentationRequest.fromJSON(
        'zk-app',
        presentationRequestJson
    );
    const credential = await Credential.fromJSON(credentialJson);
    // Context is a WalletContext which is an R extends PresentationContext.
    // not sure what its value should be here.
    const presentation = await Presentation.create(owner, {
        request: presentationRequest,
        credentials: [credential],
        context: undefined,
    });
    const presentationJson = Presentation.toJSON(presentation);

    console.log('✅ Created presentation:', presentationJson);

    return presentationJson;
}

// Verify EcdsaSigPresentation
export async function verifyEcdsaSigPresentation(
    presentationJson: string,
    zkAppAddress: PublicKey
) {
    let presentation = Presentation.fromJSON(presentationJson);
    return new EcdsaSigPresentationVerifier(zkAppAddress).verifyPresentation(
        ProvableEcdsaSigPresentation.from(presentation)
    );
}

// Hash secret
export function hashSecret<FixedString extends string>(
    secret: EnforceMaxLength<FixedString, SecretMaxLength>
): Field {
    const secretString = SecretString.from(secret as string);
    return secretString.hash();
}

