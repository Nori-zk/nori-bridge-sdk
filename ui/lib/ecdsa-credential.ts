import { Credential, DynamicBytes } from "mina-attestations";
import { EcdsaEthereum } from "mina-attestations/src/imported";
import { PrivateKey, Bytes } from "o1js";
import { id, Wallet } from "ethers";

const maxMessageLength = 32;
const proofsEnabled = false;
const Message = DynamicBytes({ maxLength: maxMessageLength });

export async function createEcdsaCredential(message: string) {
  try {
    // Prepare ECDSA credential
    await EcdsaEthereum.compileDependencies({
      maxMessageLength,
      proofsEnabled,
    });
    const EcdsaCredential = await EcdsaEthereum.Credential({
      maxMessageLength,
    });
    await EcdsaCredential.compile({ proofsEnabled });

    // Wallets
    const { publicKey: minaPubKey } = PrivateKey.randomKeypair();
    const signer = new Wallet(id("test"));

    // Signature
    const parseHex = (hex: string) => Bytes.fromHex(hex.slice(2)).toBytes();
    const hashMessage = (msg: string) => parseHex(id(msg));
    const sig = await signer.signMessage(hashMessage(message));

    // Create credential
    const { signature, parityBit } = EcdsaEthereum.parseSignature(sig);
    const credential = await EcdsaCredential.create({
      owner: minaPubKey,
      publicInput: {
        signerAddress: EcdsaEthereum.parseAddress(signer.address),
      },
      privateInput: {
        message: Message.fromString(message),
        signature,
        parityBit,
      },
    });

    // Log the credential
    console.log(
      "✅ created credential",
      Credential.toJSON(credential).slice(0, 1000) + "..."
    );

    return credential;
  } catch (error) {
    console.error("Error creating ECDSA credential:", error);
    throw error;
  }
}
