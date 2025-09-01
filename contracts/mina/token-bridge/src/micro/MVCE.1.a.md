# Preamble

We had some limited success with our end to end (e2e) flow testing in node.js some weeks ago. With this nori minter setup, it used Mina attestations to make certain assertations, about the end users crypto key material, in order to bind Mina and Ethereum accounts together. As well as computing a consensus MPT proof and proving a test Eth deposit did appear in the Eth token contract (within a given consensus transition window, from one finalised slot to another). Thus enabling our NoriTokenController to mint for the given user. These tests are found in the `<root nori-bridge-sdk>/contracts/mina/token-bridge` directory. When we attempted to run this solution in the browser (see the `<root nori-bridge-sdk>/minimal-client` workspace) we breached webassembly ram limitations on compilation of our mint worker (a webworker which enables us to generate mint proofs, setup storage and other functionality) and thus the solution could not be ported succesfully.

Attempts were made to reduce the number of ZK programs in the pipeline to reduce the amount of ram used and to keep us under the webassembly limits. The first attempt the 'slim' build (found here `<root nori-bridge-sdk>/contracts/mina/token-bridge/slim`) reduced the ZK program count by 2 by merging their logic into the NoriTokenController noriMint method and evaluating the required provable code there instead. The result of this were e2e devnet and litenet tests which worked in node.js however when they were ported to the browser (see the minimal-client workspace) the mint worker compiled succesfully (just squeezing under the webassembly ram limitations) but as soon as any method (which involve zk program computation / smart contract method invocations) of it was invoked the worker crashed with the typical 'unreachable' fatal error, indicating a ruined webassembly runtime.

A second attempt was made to reduce the number of ZK programs by removing all relating Mina attestation ZK programs and implementing a lower cost (in terms of ram) PKCE style code challenge / verifier strategy instead, this build is called 'micro' (found here `<root nori-bridge-sdk>/contracts/mina/token-bridge/micro`). This does seem to yield some success on the browser as the worker not only compiles but also we can invoke methods on it without crashing the webassembly runtime. Invocation of setupStorage including submission (via the local proxy graphql) to litenet/devnet was even succesful! This is great new but alas, we now have other issue. While we can run the e2e.litenet test on node.js and they do pass, the e2e.devnet test fails on node and in the browser with an error relating to a 'stale verification key'. This is a frustrating results as upon manual inspection of all deployed and computed zk program verification key hashes, they are all consistent within the given deployment and test scripts.

# Description

Litenet test `litenet.without-infra.spec.ts` passes while devnet `devnet.without-infra.spec.ts` fails with:

```
Error: Transaction failed with errors:
    - {"statusCode":200,"statusText":"Couldn't send zkApp command: Stale verification key detected. Please make sure that deployed verification key reflects latest zkApp changes."}
```
The method which fails on the devnet test is `WALLET_MOCK_signAndSendMintProofCache` meaning the mint proof is reject on submission to devnet although it was generated and proved succesfully locally.

Note these tests (`devnet.without-infra.spec.ts` and `litenet.without-infra.spec.ts`) are not full e2e tests they use a historical deposit, and use the nori mint functionality (within the NoriBridgeController contract) without the need for making a real deposit and waiting the ~35 minutes it takes for eth finalisation and nori bridge processing required for a new deposit. Also please know a throw away mina devnet private key is hard coded into `devnet.without-infra.spec.ts` to allow this test to be repeatable by third parties without configuring a .env file.

A readme [here](./MVCE.1.b.md) is included in this folder with instruction for how to attempt a full e2e test, however the results are the same, success with litenet and failure with devnet, and the tests take significantly more time to complete.

# Steps to reproduce

## Install and build workspaces

0. `cd <nori-bridge-sdk root directory> && npm install && npm run build`

Then you can simply run these commands:

### To test on Litenet
1. `cd <nori-bridge-sdk-root-dir>/contracts/mina/token-bridge`
2. Clear your o1js cache `rm ~/.cache/o1js/*` (on Linux may differ if using another OS)
3. `npm run test -- src/micro/litenet.without-infra.spec.ts`

### To test on Devnet
1. `cd <nori-bridge-sdk-root-dir>/contracts/mina/token-bridge`
2. Clear your o1js cache `rm ~/.cache/o1js/*` (on Linux may differ if using another OS)
3. `npm run test -- src/micro/devnet.without-infra.spec.ts`


### Speculations as to the behaviour.

This is interesting because the vks of the smart contracts / zk programs between the deployed contract and the zk workers match. You can verify this yourself by looking for logs like this `console.log(${name} contract/program vk hash compiled: '${hashStr}');` and confirm they match. Moreover looking at `https://minascan.io/devnet` it can be confirmed that the vk's of the FungibleToken and NoriTokenController contracts match what both the compiled contracts match within all the workers.

Also interesting that `zkAppWorker.MOCK_setupStorage` method can and does work, and thus perhaps we may conclude that NoriTokenController is not the cause.

I personally think the issue may related to EthVerifier and internal logic within o1js. The issue may or may not be related to the issues described [here](./MVCE.2.md)