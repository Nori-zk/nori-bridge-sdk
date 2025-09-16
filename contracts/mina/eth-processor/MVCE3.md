Unstable o1js behaviour with a particular ZKProgram and SmartContract and o1js 2.3 -> 2.9 upgrade problems.

# Preamble:

EthVerifier is a ZKProgram which performs verification of an SP1 consensus transition proof used by Nori to validate the execution state root and verify slots via MPT, it is given an SP1 and 'converted' (verified) proof allowing it to be used within o1js / Mina. EthVerifier relies on verification key and public output data of the proof conversion sp1ToPlonk zk programs which are stored within the `o1js-zk-utils/src/integrity` folder and verified within its program along with the proof input data supplied.

EthProcessor is a smart contract which verifies EthVerifier and commits details of the state of the Helios between a consesnsus transition lightclients store to state within the smart contract. It allow us to keep a continuous chain of transitions, for instance at time one we commit a hash of the helios stores state from consensus transition A -> B and at a later time ensure that the transitions proofs we are given have a helios store state with a hash matching B moving forwards in time to C, thus forming a contiguous chain of transition proofs.

We have a class `MinaEthProcessorSubmitter` where we can call a method `createProof` which unpacks proof data and create a proof using `EthVerifier.compute()`, we then call another class method `submit` which takes the generated proof and within a Mina transaction invokes an `EthProcessor.update()` method. This class also has two other methods `deploy` which is used exclusivelt within the tests to deploy a test SmartContract on lightnet. Finally the class has a `compileContracts` which compiles both EthVerifier and EthProcessor and validates the generated verification key hashes match ones 'baked' into the repository (by another script `npm run bake-vk-hashes` which compiles the program and smart contract with an emphemeral cache directory, and saves the compiled programs vk hashes into a file within the repository, which are then later used for validation - preventing the use of said programs if they compile with different vks, which can happen in a multitude of cache corruption scenarios).

MinaEthProcessorSubmitter is typically used in the following manor, when a process starts it will `compileContracts` and wait for that to continue, then the process will do a sequence of one `createProof` and then one `submit` given one set of transition proofs and loop continuously ad infinitum.

[Proof Submitter Class Definition](https://github.com/Nori-zk/nori-bridge-sdk/blob/develop/contracts/mina/eth-processor/src/proofSubmitter.ts)

We have an integration test called ProofSubmitter.spec.ts which is used to validate a few different scenarios given a set of preprepared sp1 transition proofs and their [converted](https://github.com/Nori-zk/proof-conversion) counterparts, aka we have pairs of proof data one for each consensus transition, and we use 4 'proof bundles' representing 4 Eth consensus slot transitions A->B B->C C->D D->E.

Scenarios:

1. `should run the proof submission process correctly` proves we can do a single A->B cycle. Involving the steps: compileContracts, deployContract, createProof, submit.
2. `should perform a series of proof submissions` proves we can do multiple contiguous cycles of `createProof` and `submit` A->B B->C C->D D->E. Involving steps: compileContracts, deployContract, [createProof (A->B), submit (A-B)], [createProof (B->C), submit (B-C)], [createProof (C->D), submit (C-D)], [createProof (D->E), submit (D-E)].
3. `should invoke a hash validation issue when we skip transition proofs` proves that if transition proofs are noncontiguous that EthProcessor will reject a transition. Involving steps of compileContracts, deployContract, [createProof (A->B), submit (A-B)], [createProof (C->D), submit (C-D)], and we test that submit (C-D) fails as it should.


[Proof submitted spec test](https://github.com/Nori-zk/nori-bridge-sdk/blob/develop/contracts/mina/eth-processor/src/proofSubmitter.spec.ts)

# o1js-2.3 behaviour:

Currently [develop branch](https://github.com/Nori-zk/nori-bridge-sdk/tree/develop) of nori-bridge-sdk is pinned to o1js v2.3. 

When running via `npm run test` (after following the README.md instructions) within the `contracts/mina/eth-processor` workspace, the test will eventually hang (*) without completion, one of the methods (an o1js function which returns a promise) does not resolve, nor does it reject, it remains unfulfilled indefinitely blocking the procedures completion. The test will hang without resolution after completing the 1st scenario and after 2->3 cycles of `createProof` and `submit` within the 2nd scenario, for reasons unknown to us.  The hanging behaviour is also evident in other situations as described later.

To account for this problem within the workspace `npm run test-ci` script was implemented, it runs the scenarios (1->3) one after another allowing the node process to exit after each test. In this case the tests do pass. We assumed that perhaps the re-compilation of the contracts (which is the first step of each scenario) within the same runtime, may perhaps cause the observed problems during the `createProof` and `submit` cycles breaking the o1js runtime. Later to find out this was not the only case where it can happen.

Moreover when deploying this solution within a server process (which pipes the various elements together of our stack aka `bridge head`, `proof conversion` and this element `proof submission`) we had additional problems where we could not reliably perform continuous cycles of `createProof` and `submit` indefinitely. Frequently (and always eventually) with more than two cycles of `createProof` and `submit` we noticed
the hanging behaviour (*) as also seen with `npm run test`. We mitigated this (in March) with the following technique, when the server process starts it uses one worker (process) to compile EthVerifier and EthProcessor populating the o1js default cache directory, then after compilation the worker is terminated from the parent process, only after this (to avoid contention of multiple processes attempting to populate an empty / incomplete cache) a fleet of workers is spawned (8 workers in total), each worker compiles EthVerifier and EthProcessor using the default cache directory with pre-populated cache files, each worker post compilation compares the verification key hashes against values stored within the repository (via the `npm run bake-vk-hashes` command) to ensure they compiled correctly and without corruption, if not they self terminate (this does not happen they compile correctly each time). Then each worker is used for a single cycle of `createProof` and `submit` before they are terminated and a new replacement worker is spawned which calls the compile method (with the verification of vk hashes) in preperation of its use and disposal in the future. Thus at all times there is a maintained pool of workers which are precompiled ready to perform a single `createProof` and `submit` cycle before their disposal.

This mitigation strategy has worked reliably for 7 months without a single failure (hanging/stalling event).

# o1js-2.9 behaviour:

[Link to upgrade attempt](https://github.com/Nori-zk/nori-bridge-sdk/tree/MAJOR/alpha-o1-29)
If testing remove node_modules and reinstall. If you get errors about conflicting o1js verions clear you package-lock.json and node_modules and try again.

An upgrade to EthProcessor, EthVerifier has been attempted within this repository in this branch. We set the `overrides` property of the root package.json to override all workspace members o1js peer dependancy to o1js v2.9.0 and regenerated the package-lock.json by deleting the old one, removing the node_modules folder in the root directory, and doing an npm install. The package-lock.json was manually inspected along with the contents of the node_modules folder as well as other thorough checks to ensure o1js v2.9.0 was the only installed version. Note the `overrides` also apply to dependancies where o1js is a peer dependancy such as [proof conversion](https://github.com/Nori-zk/proof-conversion), without having to re-release those packages.

We then run our `npm run bake-vk-hashes` scripts to check for VK hash changes and update integrity changes particularly the vk hashes here `o1js-zk-utils/src/integrity/EthVerifier.VkHash.json` and here `contracts/mina/eth-processor/src/integrity/EthProcessor.VkHash.json`. As the vk's changed this is a strong indication that the zk programs with [proof-conversion](https://github.com/Nori-zk/proof-conversion) may also have changed. So next we attempted to regenerate our integration test data (the 4 sp1 proofs needing proof conversion) and thus determine if we needed to update the remaining integrity files aka `contracts/mina/eth-processor/src/integrity/ProofConversion.sp1ToPlonk.po2.json` and `contracts/mina/eth-processor/src/integrity/ProofConversion.sp1ToPlonk.vkData.json`. We ran the `npm run test-ci` (within the `contracts/mina/eth-processor` workspace), ensuring we cleared our cache directories, to see if this was the case and we got an error indicating a failure to verify the existing test integration data proofs given the updated o1js runtime, which was plausibly expected to happen when an update is needed, and confirmed we needed to address proof conversion o1js dependancy version.

Next we used a [private repository](https://github.com/Nori-zk/proof-conversion-nori/blob/MAJOR/o1js-2.9.0/src/bin/createIntegrationTestData.ts) we have to regenerate the test integration data (the proof bundles) via proof conversion, for 4 sp1 transition proofs. First we had to set the `overrides` package.json member within the private repository to set o1js peer dependancy version to 2.9.0 (thus also affecting the proof conversion dependancy). Again a careful process of removing the package-lock.json and reinstalling node_modules and checking the installed o1js version was performed. 

The `npm run create-integration-test-data` script creates an output directory, from which we updated nori-bridge-sdk's `contract/mina/eth-processor/src/proofs` and `contract/mina/eth-processor/src/test_examples` directories, with the fresh integration test data, while also extracting the data from the converted proof outputs needed to correct the `ProofConversion.sp1ToPlonk.vkData.json` (the vk data with data and hash string from the last stage of the proof conversion sp1ToPlonkk zk program) and `ProofConversion.sp1ToPlonk.po2.json` (the 3rd public output of a converted proof) files. When all the integrity data was updated we rebuild all workspaces and ran `npm run bake-vk-hashes` within the `contract/mina/eth-processor` and `o1js-zk-utils` workspaces to recompile EthVerifier and EthProcessor and update the vk hashes for these programs within the respective integrity folders.

--------------------
## Test run 1 (fails)

At this point and after careful review that the procedure was conducted without error, we run the `npm run test-ci` script (after following the readme steps concerning lightnet and clearing our cache directory) within the `contracts/mina/eth-processor` workspace, this time we were hopeful of test completion. The outcome of the test was that Scenario completed with success and then during Scenario 2 it failed with the error:

```
    Constraint unsatisfied (unreduced):
    File "src/mina/src/lib/pickles/wrap_main.ml", line 514, characters 21-28
    File "src/mina/src/lib/pickles/wrap_main.ml", line 168, characters 17-24

    Constraint:
    (Equal(Var 144747)(Constant 0x0000000000000000000000000000000000000000000000000000000000000001))
    Data:
    Equal 0 1

      at s (../../../../../../../../../nix/store/zw9wgfrsagd6sjkw254mvhwhlnd5cj1r-ocaml-base-compiler-4.14.0/lib/ocaml/stdlib.ml:29:14)
      at ../../../../../../../../../nix/store/596px0jmr4zd511ci22l3l692dhwdjbh-squashed-ocaml-dependencies/lib/ocaml/4.14.0/site-lib/base/printf.ml:6:43
      at ../../../../../../../../../workspace_root/src/mina/src/lib/snarky/src/base/checked_runner.ml:159:13
      at is_true (src/mina/src/lib/snarky/src/base/snark0.ml:870:29)
      at ../../../../../../../../../workspace_root/src/mina/src/lib/pickles/wrap_main.ml:515:15
      at with_label (src/mina/src/lib/snarky/src/base/snark0.ml:1241:15)
      at ../../../../../../../../../workspace_root/src/mina/src/lib/pickles/wrap_main.ml:514:11
      at with_label (src/mina/src/lib/snarky/src/base/snark0.ml:1241:15)
      at ../../../../../../../../../workspace_root/src/mina/src/lib/concurrency/promise/js/promise.js:27:16
      at ../../../../../../../../../workspace_root/src/mina/src/lib/pickles/wrap.ml:556:59
      at handle (src/mina/src/lib/snarky/src/base/snark0.ml:1225:15)
      at _im8_ (src/mina/src/lib/pickles/wrap.ml:556:13)
      at mark_active (src/mina/src/lib/snarky/src/base/snark0.ml:1154:19)
      at _kI0_ (src/mina/src/lib/snarky/src/base/snark0.ml:1338:60)
      at as_stateful (src/mina/src/lib/snarky/src/base/snark0.ml:743:15)
      at _kWw_ (src/mina/src/lib/snarky/src/base/runners.ml:413:17)
      at run_computation (src/mina/src/lib/snarky/src/base/runners.ml:333:34)
      at ../../../../../../../../../workspace_root/src/mina/src/lib/snarky/src/base/snark0.ml:1338:27
      at finalize_is_running (src/mina/src/lib/snarky/src/base/snark0.ml:1260:15)
      at generate_witness_conv (src/mina/src/lib/snarky/src/base/snark0.ml:1337:7)
      at ../../../../../../../../../workspace_root/src/mina/src/lib/concurrency/promise/js/promise.js:38:29
      at withThreadPool (o1js/src/lib/proof-system/workers.ts:60:16)
      at prettifyStacktracePromise (o1js/src/lib/util/errors.ts:129:12)
      at Object.prove_ [as compute] (o1js/src/lib/proof-system/zkprogram.ts:480:18)
      at src/proofSubmitter.drastic.cache.removal.spec.ts:134:34
      at doTestAndCleanup (src/proofSubmitter.drastic.cache.removal.spec.ts:36:9)
      at Object.<anonymous> (src/proofSubmitter.drastic.cache.removal.spec.ts:103:9)

```

--------------------

## Test run 2 (passes)

Next we again cleared the cache directory and now this time attempted to run Scenario 1 by itself (without running the other tests) `npm run test -- -t 'should run the proof submission process correctly'`, it passed like before, I listed the contents of the cache directory and did a sha256sum of the contents.


```sh
ls ~/.cache/o1js/
```

Output:
```
lagrange-basis-fq-16384         step-pk-ethprocessor-initialize                 step-vk-ethprocessor-initialize                 wrap-pk-ethprocessor
lagrange-basis-fq-16384.header  step-pk-ethprocessor-initialize.header          step-vk-ethprocessor-initialize.header          wrap-pk-ethprocessor.header
lagrange-basis-fq-32768         step-pk-ethprocessor-setverificationkey         step-vk-ethprocessor-setverificationkey         wrap-pk-ethverifier
lagrange-basis-fq-32768.header  step-pk-ethprocessor-setverificationkey.header  step-vk-ethprocessor-setverificationkey.header  wrap-pk-ethverifier.header
lagrange-basis-fq-8192          step-pk-ethprocessor-update                     step-vk-ethprocessor-update                     wrap-vk-ethprocessor
lagrange-basis-fq-8192.header   step-pk-ethprocessor-update.header              step-vk-ethprocessor-update.header              wrap-vk-ethprocessor.header
srs-fp-65536                    step-pk-ethprocessor-updatestorehash            step-vk-ethprocessor-updatestorehash            wrap-vk-ethverifier
srs-fp-65536.header             step-pk-ethprocessor-updatestorehash.header     step-vk-ethprocessor-updatestorehash.header     wrap-vk-ethverifier.header
srs-fq-32768                    step-pk-ethverifier-compute                     step-vk-ethverifier-compute
srs-fq-32768.header             step-pk-ethverifier-compute.header              step-vk-ethverifier-compute.header
```


```sh
cd ~/.cache/o1js/
find . -type f -print0 | sort -z | xargs -0 cat | sha256sum
```

Output:
```
b96c14057a61c5a86322100ba3bfd9033c3b5d4a45d4b0a9aa6470f2e125789e
```

--------------------

## Test run 3 (fails)

Next WITHOUT removing the cache directory we run the same test scenario 1 again `npm run test -- -t 'should run the proof submission process correctly'` 

It failed with:

```
  ● MinaEthProcessorSubmittor Integration Test › should run the proof submission process correctly

    Constraint unsatisfied (unreduced):
    File "src/mina/src/lib/pickles/wrap_main.ml", line 514, characters 21-28
    File "src/mina/src/lib/pickles/wrap_main.ml", line 168, characters 17-24

    Constraint:
    (Equal(Var 144747)(Constant 0x0000000000000000000000000000000000000000000000000000000000000001))
    Data:
    Equal 0 1

      at s (../../../../../../../../../nix/store/zw9wgfrsagd6sjkw254mvhwhlnd5cj1r-ocaml-base-compiler-4.14.0/lib/ocaml/stdlib.ml:29:14)
      at ../../../../../../../../../nix/store/596px0jmr4zd511ci22l3l692dhwdjbh-squashed-ocaml-dependencies/lib/ocaml/4.14.0/site-lib/base/printf.ml:6:43
      at ../../../../../../../../../workspace_root/src/mina/src/lib/snarky/src/base/checked_runner.ml:159:13
      at is_true (src/mina/src/lib/snarky/src/base/snark0.ml:870:29)
      at ../../../../../../../../../workspace_root/src/mina/src/lib/pickles/wrap_main.ml:515:15
      at with_label (src/mina/src/lib/snarky/src/base/snark0.ml:1241:15)
      at ../../../../../../../../../workspace_root/src/mina/src/lib/pickles/wrap_main.ml:514:11
      at with_label (src/mina/src/lib/snarky/src/base/snark0.ml:1241:15)
      at ../../../../../../../../../workspace_root/src/mina/src/lib/concurrency/promise/js/promise.js:27:16
      at ../../../../../../../../../workspace_root/src/mina/src/lib/pickles/wrap.ml:556:59
      at handle (src/mina/src/lib/snarky/src/base/snark0.ml:1225:15)
      at _im8_ (src/mina/src/lib/pickles/wrap.ml:556:13)
      at mark_active (src/mina/src/lib/snarky/src/base/snark0.ml:1154:19)
      at _kI0_ (src/mina/src/lib/snarky/src/base/snark0.ml:1338:60)
      at as_stateful (src/mina/src/lib/snarky/src/base/snark0.ml:743:15)
      at _kWw_ (src/mina/src/lib/snarky/src/base/runners.ml:413:17)
      at run_computation (src/mina/src/lib/snarky/src/base/runners.ml:333:34)
      at ../../../../../../../../../workspace_root/src/mina/src/lib/snarky/src/base/snark0.ml:1338:27
      at finalize_is_running (src/mina/src/lib/snarky/src/base/snark0.ml:1260:15)
      at generate_witness_conv (src/mina/src/lib/snarky/src/base/snark0.ml:1337:7)
      at ../../../../../../../../../workspace_root/src/mina/src/lib/concurrency/promise/js/promise.js:38:29
      at withThreadPool (o1js/src/lib/proof-system/workers.ts:60:16)
      at prettifyStacktracePromise (o1js/src/lib/util/errors.ts:129:12)
      at Object.prove_ [as compute] (o1js/src/lib/proof-system/zkprogram.ts:480:18)
      at Object.<anonymous> (src/proofSubmitter.spec.ts:56:26)

```

And checking the cache directories again:

```sh
ls ~/.cache/o1js/
```

Output:
```
lagrange-basis-fp-1024          srs-fq-32768                                    step-vk-ethprocessor-update
lagrange-basis-fp-1024.header   srs-fq-32768.header                             step-vk-ethprocessor-update.header
lagrange-basis-fp-16384         step-pk-ethprocessor-initialize                 step-vk-ethprocessor-updatestorehash
lagrange-basis-fp-16384.header  step-pk-ethprocessor-initialize.header          step-vk-ethprocessor-updatestorehash.header
lagrange-basis-fp-2048          step-pk-ethprocessor-setverificationkey         step-vk-ethverifier-compute
lagrange-basis-fp-2048.header   step-pk-ethprocessor-setverificationkey.header  step-vk-ethverifier-compute.header
lagrange-basis-fp-65536         step-pk-ethprocessor-update                     wrap-pk-ethprocessor
lagrange-basis-fp-65536.header  step-pk-ethprocessor-update.header              wrap-pk-ethprocessor.header
lagrange-basis-fq-16384         step-pk-ethprocessor-updatestorehash            wrap-pk-ethverifier
lagrange-basis-fq-16384.header  step-pk-ethprocessor-updatestorehash.header     wrap-pk-ethverifier.header
lagrange-basis-fq-32768         step-pk-ethverifier-compute                     wrap-vk-ethprocessor
lagrange-basis-fq-32768.header  step-pk-ethverifier-compute.header              wrap-vk-ethprocessor.header
lagrange-basis-fq-8192          step-vk-ethprocessor-initialize                 wrap-vk-ethverifier
lagrange-basis-fq-8192.header   step-vk-ethprocessor-initialize.header          wrap-vk-ethverifier.header
srs-fp-65536                    step-vk-ethprocessor-setverificationkey
srs-fp-65536.header             step-vk-ethprocessor-setverificationkey.header
```

Note more lagrange-basis-fp files than before


```sh
cd ~/.cache/o1js/
find . -type f -print0 | sort -z | xargs -0 cat | sha256sum
```

Output:
```
97f397739132815fef6352f2244117c14de593c7e3fb3d9565234bcc43877d0c
```

Note cache has changed.

IMPORTANT: As each invocation of the scenarios tests creates a new random zk app (EthProcessor) private key and re-deployes the contract on lightnet, the repetition of this test SHOULD have succeeded and yet does not.

```typescript
process.env.ZKAPP_PRIVATE_KEY = PrivateKey.toBase58(
    PrivateKey.random()
);
```

--------------------

## Test run 4 (passes)

In light of this an other problems we have had previously with o1js I decided to clear the cache and run Scenario test 1 again with:

```sh
rm -rf ~/.cache/o1js/* && npm run test -- -t 'should run the proof submission process correctly'
```

The test passes.

And checking the cache directories again:

```sh
ls ~/.cache/o1js/
```

Output:
```
lagrange-basis-fq-16384         step-pk-ethprocessor-initialize                 step-vk-ethprocessor-initialize                 wrap-pk-ethprocessor
lagrange-basis-fq-16384.header  step-pk-ethprocessor-initialize.header          step-vk-ethprocessor-initialize.header          wrap-pk-ethprocessor.header
lagrange-basis-fq-32768         step-pk-ethprocessor-setverificationkey         step-vk-ethprocessor-setverificationkey         wrap-pk-ethverifier
lagrange-basis-fq-32768.header  step-pk-ethprocessor-setverificationkey.header  step-vk-ethprocessor-setverificationkey.header  wrap-pk-ethverifier.header
lagrange-basis-fq-8192          step-pk-ethprocessor-update                     step-vk-ethprocessor-update                     wrap-vk-ethprocessor
lagrange-basis-fq-8192.header   step-pk-ethprocessor-update.header              step-vk-ethprocessor-update.header              wrap-vk-ethprocessor.header
srs-fp-65536                    step-pk-ethprocessor-updatestorehash            step-vk-ethprocessor-updatestorehash            wrap-vk-ethverifier
srs-fp-65536.header             step-pk-ethprocessor-updatestorehash.header     step-vk-ethprocessor-updatestorehash.header     wrap-vk-ethverifier.header
srs-fq-32768                    step-pk-ethverifier-compute                     step-vk-ethverifier-compute
srs-fq-32768.header             step-pk-ethverifier-compute.header              step-vk-ethverifier-compute.header

```

```sh
cd ~/.cache/o1js/
find . -type f -print0 | sort -z | xargs -0 cat | sha256sum
```

Output:

```
b96c14057a61c5a86322100ba3bfd9033c3b5d4a45d4b0a9aa6470f2e125789e
```

------------------------------------

## Observations:

Trying to make some conclusion out of this, it seems clear that with o1js 2.9.0 it is not possible within a single runtime and without clearing caches to get more than one cycle of `createProof` and `submit`. Attempts have been made to modify the `MinaEthProcessorSubmittor` class to accept a cache directory within its constructor and to enable the use of an ephemeral cache directory such that a modified version of the [proofSubmitter.spec test namely proofSubmitter.drastic.cache.removal.spec.ts](https://github.com/Nori-zk/nori-bridge-sdk/blob/MAJOR/alpha-o1-29/contracts/mina/eth-processor/src/proofSubmitter.drastic.cache.removal.spec.ts) can be used and this test explicitly recompiles EthProcessor and EthVerifier and removes the cache directory after each cycles of `createProof` and `submit`. But thus far these attempts have failed and it seems like we may not be able to preserve the use of this integration test.

Currently our server process solution mitigation strategy will likely not work as if after one cycle of `createProof` and `submit` as the cache is corrupted it is likely that future workers will be spawned (using a common cache) in such a state that they will no be able to run `createProof` and `submit`, it is likely we will have to modify the strategy so that each worker is given its own ephemeral cache to compile within, before waiting to be invoked to do their `createProof` and `submit` before subsequent termination. This is likely to consume a siginificantly larger amount of cpu and require a hardware upgrade in order to get back to a working system. 

Moreover if on every upgrade of o1js we need to tinker with our strategy (and we are getting to the limits of what is possible to mitigate) then we will never be able to create the continuous integration pipeline we are hoping to achieve for reliable operations. Nor will we be able to validate via integration tests that vk upgrades have occured correctly (patching the integration directory files / recompilation/ rebaking of vk hashes) such that we will never be confident that without extensive manual testing that upgrades to our solution will work and be viable release candidates. 

We are uncertain at this time is updates to our server varient of EthProcessor repository will be succesful with the updates to the mitigation strategy (emphemeral cache directory per worker) + the normal single cycle of `createProof` and `submit` before worker disposal. 

