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

When running via `npm run test` (after following the README.md instructions) within the `contracts/mina/eth-processor` workspace, the test will eventually hang (\*) without completion, one of the methods (an o1js function which returns a promise) does not resolve, nor does it reject, it remains unfulfilled indefinitely blocking the procedures completion. The test will hang without resolution after completing the 1st scenario and after 2->3 cycles of `createProof` and `submit` within the 2nd scenario, for reasons unknown to us. The hanging behaviour is also evident in other situations as described later.

To account for this problem within the workspace `npm run test-ci` script was implemented, it runs the scenarios (1->3) one after another allowing the node process to exit after each test. In this case the tests do pass. We assumed that perhaps the re-compilation of the contracts (which is the first step of each scenario) within the same runtime, may perhaps cause the observed problems during the `createProof` and `submit` cycles breaking the o1js runtime. Later to find out this was not the only case where it can happen.

Moreover when deploying this solution within a server process (which pipes the various elements together of our stack aka `bridge head`, `proof conversion` and this element `proof submission`) we had additional problems where we could not reliably perform continuous cycles of `createProof` and `submit` indefinitely. Frequently (and always eventually) with more than two cycles of `createProof` and `submit` we noticed
the hanging behaviour (\*) as also seen with `npm run test`. We mitigated this (in March) with the following technique, when the server process starts it uses one worker (process) to compile EthVerifier and EthProcessor populating the o1js default cache directory, then after compilation the worker is terminated from the parent process, only after this (to avoid contention of multiple processes attempting to populate an empty / incomplete cache) a fleet of workers is spawned (8 workers in total), each worker compiles EthVerifier and EthProcessor using the default cache directory with pre-populated cache files, each worker post compilation compares the verification key hashes against values stored within the repository (via the `npm run bake-vk-hashes` command) to ensure they compiled correctly and without corruption, if not they self terminate (this does not happen they compile correctly each time). Then each worker is used for a single cycle of `createProof` and `submit` before they are terminated and a new replacement worker is spawned which calls the compile method (with the verification of vk hashes) in preperation of its use and disposal in the future. Thus at all times there is a maintained pool of workers which are precompiled ready to perform a single `createProof` and `submit` cycle before their disposal.

This mitigation strategy has worked reliably for 7 months without a single failure (hanging/stalling event).

# o1js-2.9 behaviour:

[Link to upgrade attempt](https://github.com/Nori-zk/nori-bridge-sdk/tree/MAJOR/alpha-o1-29)
If testing remove node_modules and reinstall. If you get errors about conflicting o1js verions clear you package-lock.json and node_modules and try again.

An upgrade to EthProcessor, EthVerifier has been attempted within this repository in this branch. We set the `overrides` property of the root package.json to override all workspace members o1js peer dependancy to o1js v2.9.0 and regenerated the package-lock.json by deleting the old one, removing the node_modules folder in the root directory, and doing an npm install. The package-lock.json was manually inspected along with the contents of the node_modules folder as well as other thorough checks to ensure o1js v2.9.0 was the only installed version. Note the `overrides` also apply to dependancies where o1js is a peer dependancy such as [proof conversion](https://github.com/Nori-zk/proof-conversion), without having to re-release those packages.

We then run our `npm run bake-vk-hashes` scripts to check for VK hash changes and update integrity changes particularly the vk hashes here `o1js-zk-utils/src/integrity/EthVerifier.VkHash.json` and here `contracts/mina/eth-processor/src/integrity/EthProcessor.VkHash.json`. As the vk's changed this is a strong indication that the zk programs with [proof-conversion](https://github.com/Nori-zk/proof-conversion) may also have changed. So next we attempted to regenerate our integration test data (the 4 sp1 proofs needing proof conversion) and thus determine if we needed to update the remaining integrity files aka `contracts/mina/eth-processor/src/integrity/ProofConversion.sp1ToPlonk.po2.json` and `contracts/mina/eth-processor/src/integrity/ProofConversion.sp1ToPlonk.vkData.json`. We ran the `npm run test-ci` (within the `contracts/mina/eth-processor` workspace), ensuring we cleared our cache directories, to see if this was the case and we got an error indicating a failure to verify the existing test integration data proofs given the updated o1js runtime, which was plausibly expected to happen when an update is needed, and confirmed we needed to address proof conversion o1js dependancy version.

Next we used a [private repository](https://github.com/Nori-zk/proof-conversion-nori/blob/MAJOR/o1js-2.9.0/src/bin/createIntegrationTestData.ts) we have to regenerate the test integration data (the proof bundles) via proof conversion, for 4 sp1 transition proofs. First we had to set the `overrides` package.json member within the private repository to set o1js peer dependancy version to 2.9.0 (thus also affecting the proof conversion dependancy). Again a careful process of removing the package-lock.json and reinstalling node_modules and checking the installed o1js version was performed.

The `npm run create-integration-test-data` script creates an output directory, from which we updated nori-bridge-sdk's `contract/mina/eth-processor/src/proofs` and `contract/mina/eth-processor/src/test_examples` directories, with the fresh integration test data, while also extracting the data from the converted proof outputs needed to correct the `ProofConversion.sp1ToPlonk.vkData.json` (the vk data with data and hash string from the last stage of the proof conversion sp1ToPlonkk zk program) and `ProofConversion.sp1ToPlonk.po2.json` (the 3rd public output of a converted proof) files. When all the integrity data was updated we rebuild all workspaces and ran `npm run bake-vk-hashes` within the `contract/mina/eth-processor` and `o1js-zk-utils` workspaces to recompile EthVerifier and EthProcessor and update the vk hashes for these programs within the respective integrity folders.

---

## Test run 1 (fails)

At this point and after careful review that the procedure was conducted without error, we run the `npm run test-ci` script (after following the readme steps concerning lightnet and clearing our cache directory) within the `contracts/mina/eth-processor` workspace, this time we were hopeful of test completion. The outcome of the test was that Scenario 1 completed with success and then during Scenario 2 (during the first `createProof`) it failed with the error:

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

---

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

---

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
process.env.ZKAPP_PRIVATE_KEY = PrivateKey.toBase58(PrivateKey.random());
```

---

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

---

## Test run 5 (passes):

We decided to run single compile with multiplle cycles of `createProof` and `submit`, as we see that running it more than once in the same test causes problems. So we run sequence of proof submissions (Scenario 2). 1 compile, 4 cycles of createProof and submit without compiling in between.
Note this was running on mac just so we have a different environment tested.

```sh
rm -rf /Users/<userName>/Library/Caches/o1js/* && npm run test -- -t 'should perform a series of proof submissions'
```

The test passes.

And checking the cache directories again:

```sh
ls /Users/<userName>/Library/Caches/o1js
```

Output:

```
lagrange-basis-fq-16384				step-pk-ethprocessor-setverificationkey.header	step-vk-ethprocessor-updatestorehash
lagrange-basis-fq-16384.header			step-pk-ethprocessor-update			step-vk-ethprocessor-updatestorehash.header
lagrange-basis-fq-32768				step-pk-ethprocessor-update.header		step-vk-ethverifier-compute
lagrange-basis-fq-32768.header			step-pk-ethprocessor-updatestorehash		step-vk-ethverifier-compute.header
lagrange-basis-fq-8192				step-pk-ethprocessor-updatestorehash.header	wrap-pk-ethprocessor
lagrange-basis-fq-8192.header			step-pk-ethverifier-compute			wrap-pk-ethprocessor.header
srs-fp-65536					step-pk-ethverifier-compute.header		wrap-pk-ethverifier
srs-fp-65536.header				step-vk-ethprocessor-initialize			wrap-pk-ethverifier.header
srs-fq-32768					step-vk-ethprocessor-initialize.header		wrap-vk-ethprocessor
srs-fq-32768.header				step-vk-ethprocessor-setverificationkey		wrap-vk-ethprocessor.header
step-pk-ethprocessor-initialize			step-vk-ethprocessor-setverificationkey.header	wrap-vk-ethverifier
step-pk-ethprocessor-initialize.header		step-vk-ethprocessor-update			wrap-vk-ethverifier.header
step-pk-ethprocessor-setverificationkey		step-vk-ethprocessor-update.header
```

Cache directory looks similar to test run 4 and 2.

```sh
cd /Users/<userName>/Library/Caches/o1js
find . -type f -print0 | sort -z | xargs -0 cat | sha256sum
```

Output:

```
38bbafc6d4d9755afc97969b73592f466b2113d1296659bf90a5a61c74c4c946
```

Hash of the cache dir is different from run 4 and 2 but due to the platform differences Ubuntu vs Mac this is not totally unexpected.

---

## Test run 6 (fails):

Straight after running the previous test we run it again without clearing the cache.

```sh
npm run test -- -t 'should perform a series of proof submissions'
```

That straight up fails on the very 1st `createProof`. Validating the fact that consequtive compile run of the same contracts within the same default directory causes problems, regardless of if they run in a seperate runtime instance.

It failed with the same error as before:

```
  ● MinaEthProcessorSubmittor Integration Test › should perform a series of proof submissions

   Constraint unsatisfied (unreduced):
   File "src/mina/src/lib/pickles/wrap_main.ml", line 514, characters 21-28
   File "src/mina/src/lib/pickles/wrap_main.ml", line 168, characters 17-24

   Constraint:
   (Equal(Var 144747)(Constant 0x0000000000000000000000000000000000000000000000000000000000000001))
   Data:
   Equal 0 1

     at s (../../../../../../../../nix/store/zw9wgfrsagd6sjkw254mvhwhlnd5cj1r-ocaml-base-compiler-4.14.0/lib/ocaml/stdlib.ml:29:14)
     at ../../../../../../../../nix/store/596px0jmr4zd511ci22l3l692dhwdjbh-squashed-ocaml-dependencies/lib/ocaml/4.14.0/site-lib/base/printf.ml:6:43
     at ../../../../../../../../workspace_root/src/mina/src/lib/snarky/src/base/checked_runner.ml:159:13
     at is_true (src/mina/src/lib/snarky/src/base/snark0.ml:870:29)
     at ../../../../../../../../workspace_root/src/mina/src/lib/pickles/wrap_main.ml:515:15
     at with_label (src/mina/src/lib/snarky/src/base/snark0.ml:1241:15)
     at ../../../../../../../../workspace_root/src/mina/src/lib/pickles/wrap_main.ml:514:11
     at with_label (src/mina/src/lib/snarky/src/base/snark0.ml:1241:15)
     at ../../../../../../../../workspace_root/src/mina/src/lib/concurrency/promise/js/promise.js:27:16
     at ../../../../../../../../workspace_root/src/mina/src/lib/pickles/wrap.ml:556:59
     at handle (src/mina/src/lib/snarky/src/base/snark0.ml:1225:15)
     at _im8_ (src/mina/src/lib/pickles/wrap.ml:556:13)
     at mark_active (src/mina/src/lib/snarky/src/base/snark0.ml:1154:19)
     at _kI0_ (src/mina/src/lib/snarky/src/base/snark0.ml:1338:60)
     at as_stateful (src/mina/src/lib/snarky/src/base/snark0.ml:743:15)
     at _kWw_ (src/mina/src/lib/snarky/src/base/runners.ml:413:17)
     at run_computation (src/mina/src/lib/snarky/src/base/runners.ml:333:34)
     at ../../../../../../../../workspace_root/src/mina/src/lib/snarky/src/base/snark0.ml:1338:27
     at finalize_is_running (src/mina/src/lib/snarky/src/base/snark0.ml:1260:15)
     at generate_witness_conv (src/mina/src/lib/snarky/src/base/snark0.ml:1337:7)
     at ../../../../../../../../workspace_root/src/mina/src/lib/concurrency/promise/js/promise.js:38:29
     at withThreadPool (o1js/src/lib/proof-system/workers.ts:60:16)
     at prettifyStacktracePromise (o1js/src/lib/util/errors.ts:129:12)
     at Object.prove_ [as compute] (o1js/src/lib/proof-system/zkprogram.ts:480:18)
     at Object.<anonymous> (src/proofSubmitter.spec.ts:98:30)

```

And checking the cache directories again:

```sh
ls /Users/<userName>/Library/Caches/o1js
```

Output:

```
lagrange-basis-fp-1024				srs-fq-32768					step-vk-ethprocessor-update
lagrange-basis-fp-1024.header			srs-fq-32768.header				step-vk-ethprocessor-update.header
lagrange-basis-fp-16384				step-pk-ethprocessor-initialize			step-vk-ethprocessor-updatestorehash
lagrange-basis-fp-16384.header			step-pk-ethprocessor-initialize.header		step-vk-ethprocessor-updatestorehash.header
lagrange-basis-fp-2048				step-pk-ethprocessor-setverificationkey		step-vk-ethverifier-compute
lagrange-basis-fp-2048.header			step-pk-ethprocessor-setverificationkey.header	step-vk-ethverifier-compute.header
lagrange-basis-fp-65536				step-pk-ethprocessor-update			wrap-pk-ethprocessor
lagrange-basis-fp-65536.header			step-pk-ethprocessor-update.header		wrap-pk-ethprocessor.header
lagrange-basis-fq-16384				step-pk-ethprocessor-updatestorehash		wrap-pk-ethverifier
lagrange-basis-fq-16384.header			step-pk-ethprocessor-updatestorehash.header	wrap-pk-ethverifier.header
lagrange-basis-fq-32768				step-pk-ethverifier-compute			wrap-vk-ethprocessor
lagrange-basis-fq-32768.header			step-pk-ethverifier-compute.header		wrap-vk-ethprocessor.header
lagrange-basis-fq-8192				step-vk-ethprocessor-initialize			wrap-vk-ethverifier
lagrange-basis-fq-8192.header			step-vk-ethprocessor-initialize.header		wrap-vk-ethverifier.header
srs-fp-65536					step-vk-ethprocessor-setverificationkey
srs-fp-65536.header				step-vk-ethprocessor-setverificationkey.header
```

Additional lagrange-basis-fq files observed again.

```sh
cd /Users/<userName>/Library/Caches/o1js
find . -type f -print0 | sort -z | xargs -0 cat | sha256sum
```

Output:

```
da49437134f00544ce2fb7a09d2f70486b0f43af38254f2fec2285b63422c1c0
```

Hash of cache dir files has changed compared to test run 6.

---

## Conclusions:

In comparison to 2.3, with o1js 2.9.0; it is no longer possible to have multiple `MinaEthProcessorSubmittor` class instances in different runtimes share a common cache. After any Contract/ZKProgram re-compilation (regardless of being in a new runtime or not) the `createProof` will always immediately fail on the next invocation of it. After each unique cache directory is populated, it should never be used again by subsequent processes/instances due to some sort of corruption (perhaps the differing cache dir contents is a clue).

While using an ephemeral cache directory, for each noval instance of our programs is wasteful in terms of CPU, it is not determined to be a substantive blocker at this time. We do however need to refactor various components of our stack to account for this new behaviour and this will take some time.

1. `MinaEthProcessorSubmittor` needs to be modified to take a cache directory as a constructor argument and each instance given a unique directory to compile into (DONE).
2. `compileAndVerifyContracts` one of our utilities which compiles programs and validates integrity hashes also needed to be re-written to support an optional cache directory (DONE). 
3. Our integration test `proofSubmitter.spec` is no longer viable, as on each subsequent `compile` of the Contracts/ZKPrograms the `createProof` methods always immediately fail. Meaning not even the mitigation test runner script `npm run test-ci` (which exited the runtime after each individual test scenario to avoid hanging in 2.3 when running `npm run test`) will work anymore.
4. [proofSubmitter.ephemeral.cache.spec.ts](https://github.com/Nori-zk/nori-bridge-sdk/blob/MAJOR/alpha-o1-29/contracts/mina/eth-processor/src/proofSubmitter.ephemeral.cache.spec.ts) is introduced replacing the previous integration test, it uses a helper function `doTestAndCleanup` to create and remove a noval cache directory for each test (scenario 1->3), and I needed to write a new test runner script `test-ci:cache-removal` to again exit the runtime after each individual test is completed (DONE).
5. Our current mitigation strategy used in the server variant needs a rewrite, we no longer should use a single worker to pre-populate a common cache, as this cache will be ruined after re-use by the subsequently spawned worker pool. Instead we need to adapt the workers, to each have their own cache directory and to clean this up after they run a cycle of `createProof` and `submit`. We will continue to only use a worker for only a single cycle as I dont hold much faith that some cycle will not eventually hang (*) as with the 2.3 behaviour and finding out this practically by removing the single cycle strategy in our deployment, later to find out that it may stall like with 2.3, would have a large impact in time spent deploying, monitoring and re-deploying (TODO).
6. We need to run our additional integration tests to ensure the modified mitigation strategy is successful (TODO).
7. Re-release of stack and subsequent deployment (TODO).
8. Updates to token-bridge and running tests of lightnet, devnet and minimal client (TODO).

We are uncertain at this time is updates to our server varient of EthProcessor repository will be succesful, but think it quite likely that there will be a viable way forward; with the updates to the mitigation strategy (emphemeral cache directory per worker) + the normal single cycle of `createProof` and `submit` before worker disposal. We have additional integration tests which will be done, in the near term to attempt to determine this.

Similary we remain somewhat uncertain that when EthProcessor is re-integrated with the TokenController logic that that will be successful, we need to update the entire stack first before doing this, due to the proximity to our target testnet event this will likely be delayed for some time.

## Opinions / experience:

These particular behaviours of o1js have been hard, idiosyncratic and expensive to mitigate with creative strategies which shouldn't really be necessary. I.e. solutions to check verification key integrity due to nondeterministic vk derivations in various scenarios, disposing of runtimes after particular sequences of operations, need for ephemeral cache directories, changes to vk during non major version upgrades of o1js. It puts a high burden on maintenance and domain knowledge of undocumented behaviours within o1js for the developers wishing to build their solutions and to make them reliable.

If on every upgrade of o1js we need to tinker with our mitigation strategies / update integration tests, then we will never be able to create the continuous integration/deployment pipeline we are hoping to achieve for reliable operations, and will incur great expense in maintaining our solution. Without extensive manual testing, we lack confidence that upgrades to our solution will function properly and be viable release candidates, this is somewhat disappointing.

The mutable cache within o1js is not currently a working strategy and needs attention.