import {
  AccountUpdate,
  Bool,
  Cache,
  fetchAccount,
  Field,
  Lightnet,
  Mina,
  NetworkId,
  Poseidon,
  PrivateKey,
  PublicKey,
  TokenId,
  UInt64,
  UInt8,
  // Keypair,
  Provable,
  VerificationKey,
} from 'o1js';
import { FungibleToken } from './TokenBase.js';


(async () => {
  const Blockchain = Mina.Network({
    mina: "https://api.minascan.io/node/devnet/v1/graphql",
  });
  Mina.setActiveInstance(Blockchain);

  const fee = 1e8
  const tokenAddr = PublicKey.fromBase58("B62qp1YBCbuvBsXFVLGMU5ASmv1r4BbTRW4epHuEz3CHbLL8wfjje4F")
  const token = new FungibleToken(tokenAddr)
  const myPrivKey = PrivateKey.fromBase58("")
  await FungibleToken.compile()

  const burnTx = await Mina.transaction({
    sender: myPrivKey.toPublicKey(),
    fee,
  }, async () => {
    await token.burn(myPrivKey.toPublicKey(), new UInt64(10010000000000000000000000000))
  })
  await burnTx.prove()
  burnTx.sign([myPrivKey])
  const burnTxResult = await burnTx.send().then((v) => v.wait())
  console.log("Burn tx result:", burnTxResult.toPretty())

})()  