import {
    Field,
    Bytes,
    PublicKey,
    PrivateKey,
    UInt64,
    SmartContract,
    declareMethods,
} from 'o1js';
import {
    BridgeEthFinalizationStatus,
    BridgeLastStageState,
    KeyTransitionStageEstimatedTransitionTime,
    KeyTransitionStageMessageTypes,
    Sp1ProofAndConvertedProofBundle,
    TransitionNoticeMessageType,
    VerifiedContractStorageSlot,
    WebSocketServiceTopicSubscriptionMessage,
} from '@nori-zk/pts-types';
import { InvertedPromise, NodeProofLeft, wordToBytes } from '@nori-zk/proof-conversion/min';
import { clearInterval } from 'node:timers';
import {
    EthVerifier,
    ContractDepositAttestor,
    Bytes20,
    Bytes32,
    ContractDeposit,
    buildContractDepositLeaves,
    getContractDepositWitness,
    computeMerkleTreeDepthAndSize,
    foldMerkleLeft,
    getMerkleZeros,
    ContractDepositAttestorInput,
    EthInput,
    decodeConsensusMptProof,
    EthProof,
    ContractDepositAttestorProof,
    fieldToBigIntLE,
    fieldToHexLE,
} from '@nori-zk/o1js-zk-utils';
import {
    EthDepositProgramInput,
    EthDepositProgram,
} from './e2ePrerequisites.js';
import {
    fieldToHexBE,
    uint8ArrayToBigIntBE,
} from '@nori-zk/o1js-zk-utils/build/utils.js';
import { hexStringToUint8Array } from './testUtils.js';



describe('should perform an end to end pipeline', () => {
    async function connectWebsocket(
        onData: (event: MessageEvent<string>) => void,
        onClose: (event: CloseEvent) => void
    ): Promise<WebSocket> {
        return new Promise((resolve, reject) => {
            let timeout: NodeJS.Timeout;
            const webSocket = new WebSocket('wss://wss.nori.it.com');
            webSocket.addEventListener('open', (event) => {
                console.log('WebSocket is opened', event);
                timeout = setInterval(() => {
                    webSocket.send(JSON.stringify({ method: 'ping' })); // Keep the connection alive
                }, 3000);
                resolve(webSocket);
            });

            webSocket.addEventListener('error', (event) => {
                console.error('Websocket Error', event);
                if (timeout) clearInterval(timeout);
                reject(webSocket);
            });

            webSocket.addEventListener('message', (event) => {
                if (event.data === '{"data":"pong"}') return; // Ignore pong results
                onData(event);
            });

            webSocket.addEventListener('close', (event) => onClose(event));
        });
    }

    async function proofConversionServiceRequest(
        depositBlockNumber: number
    ): Promise<Sp1ProofAndConvertedProofBundle> {
        const fetchResponse = await fetch(
            `https://pcs.nori.it.com/converted-consensus-mpt-proofs/${depositBlockNumber}`
        );
        console.log('fetchResponse GET', fetchResponse);
        const json = await fetchResponse.json();
        console.log('parsedjson', json, typeof json);
        if ('error' in json) throw new Error(json.error as string);
        return json;
    }

    async function lockTokens(attestationHash: Field, amount: number) {
        // Lock guard
        expect(amount).toBeLessThan(0.001);

        // Ensure we can do the field -> hex -> field round trip
        const beBytes = Bytes.from(wordToBytes(attestationHash, 32).reverse());
        const attestationHex = beBytes.toHex();
        console.log('attestationHex', attestationHex);
        const bytesFromHex = Bytes.fromHex(attestationHex); // this is be
        let fieldFromHex = new Field(0);
        for (let i = 0; i < 32; i++) {
            fieldFromHex = fieldFromHex
                .mul(256)
                .add(bytesFromHex.bytes[i].value);
        }
        expect(fieldFromHex.toBigInt()).toEqual(attestationHash.toBigInt());
        console.log(fieldFromHex.toBigInt(), attestationHash.toBigInt());

        // Use the ethereum package to lock our tokens
        const { spawn } = await import('node:child_process');
        const { fileURLToPath } = await import('url');
        const { resolve, dirname } = await import('node:path');
        const __filename = fileURLToPath(import.meta.url);
        const rootDir = dirname(__filename);
        const commandDetails: [string, string[], { cwd: string }] = [
            'npm',
            ['run', 'test:lock', `0x${attestationHex}`, amount.toString()],
            { cwd: resolve(rootDir, '..', '..', '..', 'ethereum') },
        ];
        console.log('commandDetails', commandDetails);
        const [command, args, options] = commandDetails;
        const child = spawn(command, args, options);
        let data = '';
        let error = '';
        for await (let chunk of child.stdout) {
            data += chunk;
        }
        for await (let chunk of child.stderr) {
            error += chunk;
        }
        await new Promise((resolve, reject) =>
            child.on('close', (code) => {
                if (code)
                    return reject(
                        new Error(
                            `Process exited non zero code ${code}\n${error}`
                        )
                    );
                resolve(code);
            })
        );
        console.log(`Lock output:\n${data}`);
        console.log('----------------------');
        const match = data.match(/Transaction included in block number: (\d+)/);
        if (!match) return null;
        return parseInt(match[1]);
    }

    async function getEthereumEnvPrivateKey() {
        const { fileURLToPath } = await import('url');
        const { resolve, dirname } = await import('node:path');
        const __filename = fileURLToPath(import.meta.url);
        const rootDir = dirname(__filename);

        const fs = await import('fs');
        const dotenv = await import('dotenv');

        const envBuffer = fs.readFileSync(
            resolve(rootDir, '..', '..', '..', 'ethereum', '.env')
        );
        const parsed = dotenv.parse(envBuffer);
        //console.log(parsed);
        return parsed.ETH_PRIVATE_KEY as string;
    }

    async function getEthWallet() {
        const privateKey = await getEthereumEnvPrivateKey();
        const { ethers } = await import('ethers');
        return new ethers.Wallet(privateKey);
    }

    beforeAll(() => {});

    test('get_eth_address', async () => {
        console.log((await getEthWallet()).address);
    });

    /*test('websockets_test', async () => {
        const webSocket = await connectWebsocket((event) => {
            console.log(JSON.stringify(JSON.parse(event.data),null,2));
        }, console.error);

        // Subscribe to relevant topics needed to facilitate bridging.
        webSocket.send(
            JSON.stringify({
                method: 'subscribe',
                topic: 'state.eth',
            })
        );
        webSocket.send(
            JSON.stringify({
                method: 'subscribe',
                topic: 'state.bridge',
            })
        );
        webSocket.send(
            JSON.stringify({
                method: 'subscribe',
                topic: 'timings.notices.transition',
            })
        );

        const invertedPromise = new InvertedPromise();
        await invertedPromise.promise;
    });*/

    /*test('should_get_credential', async () => {
        const ethWallet = await getEthWallet();
        let { publicKey: minaPubKey } = PrivateKey.randomKeypair();
        const credential = await getCredential(ethWallet, minaPubKey);
        console.log(
            '✅ created credential',
            Credential.toJSON(credential).slice(0, 1000) + '...'
        );
        console.log('--------------------');
        console.log(JSON.stringify(credential.witness.proof, null, 2));
        console.log('--------------------');
        //console.log(JSON.stringify(credential.witness.proof.proof, null, 2)); // this is a big int
        credential.witness.type;
        credential.witness.vk;
        await Credential.validate(credential);

        // Todo credential presentation
    });*/

    test('connect_to_wss_and_await_message', async () => {
        const invertedPromise = new InvertedPromise<
            MessageEvent<string>,
            CloseEvent
        >();
        function onData(event: MessageEvent<string>) {
            console.log('Got first message', event.data);
            invertedPromise.resolve(event);
        }
        function onClose(event: CloseEvent) {
            console.error('Connection closed', event);
            invertedPromise.reject(event);
        }

        const webSocket = await connectWebsocket(onData, onClose);

        webSocket.send(
            JSON.stringify({
                method: 'subscribe',
                topic: 'timings.notices.transition',
            })
        );

        await invertedPromise.promise;
        webSocket.close();
    }, 1000000000);

    test('fetch_proof_from_block_number', async () => {
        await proofConversionServiceRequest(4162671);
    });

    test('fetch_proof_from_block_number_handle_error', async () => {
        const responseJson = proofConversionServiceRequest(
            'hello' as unknown as number
        );
        expect(responseJson).rejects.toThrow("Invalid block number 'hello'");
    });

    test('lock_token', async () => {
        const blockNumber = await lockTokens(new Field(10111011), 0.000001);
        console.log('block_number', blockNumber);
    });

    /*test('timing_service', async () => {
        const exitPromise = new InvertedPromise();
        function onClose(event: CloseEvent) {
            console.error('Connection closed', event);
            exitPromise.reject(event);
        }

        let lastElapsedTime: {
            [key in TransitionNoticeMessageType]?: number;
        } = {};

        function onData(event: MessageEvent<string>) {
            let data = JSON.parse(
                event.data
            ) as WebSocketServiceTopicSubscriptionMessage;
            if (data.message_type === 'TransitionTiming') {
                lastElapsedTime = data.extension;
            }
        }

        setInterval(() => {
            console.log(lastElapsedTime);
        }, 1000);

        const webSocket = await connectWebsocket(onData, onClose);
        webSocket.send(
            JSON.stringify({
                method: 'subscribe',
                topic: 'timings.notices.transition',
            })
        );
        await exitPromise.promise;
        webSocket.close();
    }, 1000000000);*/

    test('e2e_pipeline_with_services', async () => {
        // Before we start we need access to a wallet and an attested credential....

        // Get eth wallet -----------------------------------------------------------
        const ethWallet = await getEthWallet();
        const ethAddressLowerHex = ethWallet.address.toLowerCase();
        console.log('ethAddressLowerHex', ethAddressLowerHex);

        // Get attestation properly TODO
        // const bytes = Bytes.from(<bigInt credintial.witness.proof.proof>)
        // bytes.toFields()
        // then poseidon hash these fields together (might this be to expensive as proofs are like 100k?)

        const credentialAttestationHash = Field.random(); // For now random mock
        const beAttestationHashBytes = Bytes.from(
            wordToBytes(credentialAttestationHash, 32).reverse()
        );
        const attestationBEHex = `0x${beAttestationHashBytes.toHex()}`; // this does not have the 0x....
        console.log('attestationBEHex', attestationBEHex);

        // Now we can start thinking about the bridge's status and the locking.

        // Setup first the bridge head state machine...

        const initPromise = new InvertedPromise<void, Error>();
        const exitPromise = new InvertedPromise<void, Error | CloseEvent>();

        let bridgeStageTimings: KeyTransitionStageEstimatedTransitionTime;
        let bridgeState: BridgeLastStageState;
        let ethState: BridgeEthFinalizationStatus;

        let highLevelState = 'initalising';
        let subStage: string | null = null;
        let depositBlockNumber: number;
        let stageWaitTime: number | null = null;

        let timeTrackInterval: NodeJS.Timeout;
        let ethFinalityTickerHandler: NodeJS.Timeout;
        let stageElapsedSecIncrementorTimeout: NodeJS.Timeout;

        // Utility to calculate the slot -> block delta
        function getBlockToSlotDelta(): number | undefined {
            if (
                ethState == null &&
                Number.isFinite(ethState.latest_finality_block_number) &&
                Number.isFinite(ethState.latest_finality_slot)
            )
                return undefined;
            return (
                (ethState.latest_finality_slot as number) -
                (ethState.latest_finality_block_number as number)
            );
        }

        // Estimator for eth finality transitions
        // TODO how to improve this estimate?
        // Perhaps inspect how far we are from finality but if we exceed it by some margin assume we wait for the next finality before
        // the bridge head accepts this new state.... due to low vote counts being rejected.
        function setEthFinalityEstimatorTicker(depositBlockNumber: number) {
            const delta = getBlockToSlotDelta();
            if (delta === undefined) return;

            const depositSlot = depositBlockNumber + delta;
            const roundedSlot = Math.ceil(depositSlot / 32) * 32;
            const targetBlock = roundedSlot - delta;

            const blocksRemaining =
                targetBlock - (ethState.latest_finality_block_number as number);
            let timeToWait = blocksRemaining * 12;
            stageWaitTime = Math.max(0, timeToWait);

            clearInterval(ethFinalityTickerHandler);
            ethFinalityTickerHandler = setInterval(() => {
                timeToWait -= 1;
                stageWaitTime = Math.max(0, timeToWait);
                if (stageWaitTime === 0) {
                    // if we hit zero guess that it will occur in next finality time...
                    timeToWait = 384;
                }
            }, 1000);
        }

        // Utility to track compared to our deposit do we need to wait for finality.
        let previousFinalityBlockNumber: number | null = null;
        function determineDepositMintReadyness() {
            if (ethState.latest_finality_block_number === 'unknown') return;

            const hasChanged =
                ethState.latest_finality_block_number !==
                previousFinalityBlockNumber;
            if (!hasChanged) return;

            if (
                !['locking_tokens', 'waiting_for_eth_finality'].includes(
                    highLevelState
                )
            )
                return;

            previousFinalityBlockNumber = ethState.latest_finality_block_number;

            const diff =
                depositBlockNumber - ethState.latest_finality_block_number;
            console.log('diff', diff);
            if (diff > 0) {
                highLevelState = 'waiting_for_eth_finality';
                setEthFinalityEstimatorTicker(depositBlockNumber);
            } else {
                const inputBlock = bridgeState.input_block_number as number;
                const outputBlock = bridgeState.output_block_number as number;
                if (
                    inputBlock <= depositBlockNumber &&
                    depositBlockNumber <= outputBlock
                ) {
                    // Deposit is in the current job window
                    highLevelState = 'waiting_for_current_job_completion';
                } else if (outputBlock < depositBlockNumber) {
                    // Job has not yet reached the deposit
                    highLevelState = 'waiting_for_previous_job_completion';
                } else {
                    // Deposit missed the job window
                    highLevelState = 'missed_minting_oppertunity';
                }
                stageWaitTime = 0;
                clearInterval(ethFinalityTickerHandler);
                trackJobCompletion();
            }
        }

        let ethVerifierProof: InstanceType<typeof EthProof>;
        let depositAttestationProof: InstanceType<
            typeof ContractDepositAttestorProof
        >;
        let despositSlotRaw: VerifiedContractStorageSlot;

        let proofsBuilt = false;
        let invokedCompute = false;
        // When subStage === TransitionNoticeMessageType.ProofConversionJobSucceeded && highLevelState === 'waiting_for_current_job_completion'
        // Occurs the proof conversion will have finished and a proof bundle + the window's contract deposits will be store and ready to be served by pcs.nori.it.com
        // Fetch the bundle... Compute the deposit attestation and verify the proof. Set proofsBuilt=true when all done....
        async function fetchContractWindowProofsSlotsAndCompute() {
            if (invokedCompute === true) return;
            invokedCompute = true;
            console.log(
                `Fetching proof bundle for deposit with block number: ${depositBlockNumber}`
            );

            console.time('proofConversionServiceRequest');
            const {
                consensusMPTProof: {
                    proof: consensusMPTProofProof,
                    contract_storage_slots:
                        consensusMPTProofContractStorageSlots,
                },
                consensusMPTProofVerification: consensusMPTProofVerification,
            } = await proofConversionServiceRequest(depositBlockNumber);
            console.timeEnd('proofConversionServiceRequest');

            console.log(
                'consensusMPTProofVerification, consensusMPTProofProof, consensusMPTProofContractStorageSlots',
                consensusMPTProofVerification,
                consensusMPTProofProof,
                consensusMPTProofContractStorageSlots
            );

            // Find deposit
            console.log(
                `Finding deposit within bundle.consensusMPTProof.contract_storage_slots`
            );
            const depositIndex =
                consensusMPTProofContractStorageSlots.findIndex(
                    (slot) =>
                        slot.slot_key_address === ethAddressLowerHex &&
                        slot.slot_nested_key_attestation_hash ===
                            attestationBEHex
                );
            if (depositIndex === -1)
                throw new Error(
                    `Could not find deposit index with attestationBEHex: ${attestationBEHex}, ethAddressLowerHex:${ethAddressLowerHex} in slots ${JSON.stringify(
                        consensusMPTProofContractStorageSlots,
                        null,
                        4
                    )}`
                );
            console.log(
                `Found deposit within bundle.consensusMPTProof.contract_storage_slots`
            );
            despositSlotRaw =
                consensusMPTProofContractStorageSlots[depositIndex];
            const totalDespositedValue = despositSlotRaw.value; // this is a hex // would be nice here to print a bigint
            console.log(
                `Total deposited to date (hex): ${totalDespositedValue}`
            );

            // Build contract storage slots (to be hashed)
            const contractStorageSlots =
                consensusMPTProofContractStorageSlots.map((slot) => {
                    console.log({
                        add: slot.slot_key_address.slice(2).padStart(40, '0'),
                        attr: slot.slot_nested_key_attestation_hash
                            .slice(2)
                            .padStart(64, '0'),
                        value: slot.value.slice(2).padStart(64, '0'),
                    });
                    const addr = Bytes20.fromHex(
                        slot.slot_key_address.slice(2).padStart(40, '0')
                    );
                    const attestation = Bytes32.fromHex(
                        slot.slot_nested_key_attestation_hash
                            .slice(2)
                            .padStart(64, '0')
                    );
                    const value = Bytes32.fromHex(
                        slot.value.slice(2).padStart(64, '0')
                    );
                    return new ContractDeposit({
                        address: addr,
                        attestationHash: attestation,
                        value,
                    });
                });
            // Select our deposit
            const depositSlot = contractStorageSlots[depositIndex];

            // Build deposit witness

            // Build leaves
            console.time('buildContractDepositLeaves');
            const leaves = buildContractDepositLeaves(contractStorageSlots);
            console.timeEnd('buildContractDepositLeaves');

            // Compute path
            console.time('getContractDepositWitness');
            const path = getContractDepositWitness([...leaves], depositIndex);
            console.timeEnd('getContractDepositWitness');

            // Compute root
            const { depth, paddedSize } = computeMerkleTreeDepthAndSize(
                leaves.length
            );
            console.time('foldMerkleLeft');
            const rootHash = foldMerkleLeft(
                leaves,
                paddedSize,
                depth,
                getMerkleZeros(depth)
            );
            console.timeEnd('foldMerkleLeft');
            console.log(`Computed Merkle root: ${rootHash.toString()}`);

            // Build ZK input
            const depositProofInput = new ContractDepositAttestorInput({
                rootHash,
                path,
                index: UInt64.from(depositIndex),
                value: depositSlot,
            });
            console.log('Prepared ContractDepositAttestorInput');

            // Prove deposit
            console.time('ContractDepositAttestor.compute');
            // Retype because of erasure at package level :(
            depositAttestationProof = (
                await ContractDepositAttestor.compute(depositProofInput)
            ).proof as InstanceType<typeof ContractDepositAttestorProof>;

            console.timeEnd('ContractDepositAttestor.compute');

            // Verify consensus mpt proof
            console.log('Loaded sp1PlonkProof and conversionOutputProof');
            const ethVerifierInput = new EthInput(
                decodeConsensusMptProof(consensusMPTProofProof)
            );
            console.log('Decoded EthInput from MPT proof');

            console.log('Parsing raw SP1 proof using NodeProofLeft.fromJSON');
            // Watch out because the ts ignore prevent you seeing if NodeProofLeft has been imported!
            // @ts-ignore this is silly! why!
            const rawProof = await NodeProofLeft.fromJSON(
                consensusMPTProofVerification.proofData
            );
            console.log('Parsed raw SP1 proof using NodeProofLeft.fromJSON');

            console.log('Computing EthVerifier');
            console.time('EthVerifier.compute');
            ethVerifierProof = (
                await EthVerifier.compute(ethVerifierInput, rawProof)
            ).proof;
            console.timeEnd('EthVerifier.compute');

            console.log(`All proofs built needed to mint!`);
            proofsBuilt = true;
        }

        // A mock program which mostly demonstraights the pre-requisites needed to actually mint.
        let invokedMintMock = false;
        async function performMintMock() {
            if (highLevelState !== 'can_mint') return;
            if (invokedMintMock === true) return;
            if (proofsBuilt === false) {
                console.warn(
                    'warning proofsBuilt is can_mint but proofsBuilt === false'
                );
                return;
            }
            invokedMintMock = true;
            highLevelState = 'minting';
            const e2ePrerequisitesInput = new EthDepositProgramInput({
                credentialAttestationHash,
            });

            console.time('E2EPrerequisitesProgram.compute');
            const e2ePrerequisitesProof = await EthDepositProgram.compute(
                e2ePrerequisitesInput,
                ethVerifierProof,
                depositAttestationProof
            );
            console.timeEnd('E2EPrerequisitesProgram.compute');

            console.log('Computed E2EPrerequisitesProgram proof');

            const { totalLocked, storageDepositRoot, attestationHash } =
                e2ePrerequisitesProof.proof.publicOutput;

            // Change these to asserts in future

            console.log('--- Decoded public output ---');
            console.log(
                `proved [totalLocked] (LE bigint): ${fieldToBigIntLE(
                    totalLocked
                )}`
            );
            console.log(
                'bridge head [totalLocked] (BE bigint):',
                uint8ArrayToBigIntBE(
                    hexStringToUint8Array(despositSlotRaw.value)
                )
            );

            console.log(
                `proved [attestationHash] (BE hex): ${fieldToHexBE(
                    attestationHash
                )}`
            );
            console.log(
                `bridge head [attestationHash] (BE hex):`,
                despositSlotRaw.slot_nested_key_attestation_hash
            );
            console.log(
                `original [attestationHash] (BE Hex):`,
                attestationBEHex
            );

            // Address

            console.log('original [address]:', ethAddressLowerHex);
            console.log(
                'bridge head [address]:',
                despositSlotRaw.slot_key_address
            );
            // what about checking depositAttestationProof depositAttestationProof.publicInput.value.address

            // todo print something to show storageDepositRoot

            highLevelState = 'minted';

            exitPromise.resolve();
        }

        // When the bridge state changes check whether or not we can mint
        async function trackJobCompletion() {
            if (
                ![
                    'waiting_for_previous_job_completion',
                    'waiting_for_current_job_completion',
                ].includes(highLevelState)
            )
                return;
            if (subStage === bridgeState.stage_name) return;

            if (
                subStage ===
                    TransitionNoticeMessageType.ProofConversionJobSucceeded &&
                highLevelState === 'waiting_for_current_job_completion'
            ) {
                await fetchContractWindowProofsSlotsAndCompute();
            } else if (
                subStage ===
                TransitionNoticeMessageType.EthProcessorTransactionFinalizationSucceeded
            ) {
                // but here we need to detect if our finalized eth status is beyond the last block number because otherwise we are again waiting for finalization before the job will
                // resume FIXME
                if (highLevelState === 'waiting_for_previous_job_completion') {
                    highLevelState = 'waiting_for_current_job_completion';
                } else if (
                    highLevelState === 'waiting_for_current_job_completion'
                ) {
                    highLevelState = 'can_mint';
                }
                clearInterval(timeTrackInterval);
                stageWaitTime = 0;
            }
            subStage = bridgeState.stage_name;
            let timeEstimate =
                Number(
                    bridgeStageTimings[
                        bridgeState.stage_name as KeyTransitionStageMessageTypes
                    ]
                ) || 15;
            timeEstimate -= bridgeState.elapsed_sec as number;

            stageWaitTime = timeEstimate;
            clearInterval(timeTrackInterval);
            timeTrackInterval = setInterval(() => {
                timeEstimate--;
                stageWaitTime = timeEstimate;
                if (
                    subStage ===
                        TransitionNoticeMessageType.EthProcessorTransactionFinalizationSucceeded &&
                    timeEstimate === -1
                ) {
                    // if we go negative then here we can assume that
                    // we are awaiting eth finality (FIXME make this more robust)
                    timeEstimate = 384;
                    stageWaitTime = timeEstimate;
                }
            }, 1000);
        }

        // Websocket server wss.nori.it.com event handlers.

        // Callback method for subscribed events from wss.nori.it.com
        async function onData(event: MessageEvent<string>) {
            try {
                const data = JSON.parse(
                    event.data
                ) as WebSocketServiceTopicSubscriptionMessage;
                // Eth finalization status has changes
                if (data.topic === 'state.eth') {
                    console.log('state.eth', data);
                    ethState = data.extension;
                    determineDepositMintReadyness();
                }
                // The bridge has progressed with its jobs
                else if (data.topic === 'state.bridge') {
                    console.log('state.bridge', data);
                    bridgeState = data.extension;
                    clearInterval(stageElapsedSecIncrementorTimeout);
                    stageElapsedSecIncrementorTimeout = setTimeout(() => {
                        (bridgeState.elapsed_sec as number) += 1;
                    }, 1000);
                    await trackJobCompletion();
                    await performMintMock();
                }
                // We have an update to timing estimates for the various bridge stages
                else if (data.topic === 'timings.notices.transition') {
                    //console.log('timings.notices.transition', data);
                    bridgeStageTimings = data.extension;
                }
                // If we have enough of a picture of the bridge head stage allow the user to lock tokens.
                if (
                    ethState &&
                    ethState.latest_finality_block_number !== 'unknown' &&
                    bridgeState &&
                    bridgeState.stage_name !== 'unknown' &&
                    bridgeStageTimings
                )
                    initPromise.resolve();
            } catch (e) {
                const error = e as unknown as Error;
                console.error(error.stack);
                exitPromise.reject(error);
                initPromise.reject(error);
            }
        }

        // On wss.nori.it.com websocket close handler.
        function onClose(event: CloseEvent) {
            console.error('Connection closed', event);
            exitPromise.reject(event);
        }

        // Create a websocket connect to wss.nori.it.com
        const webSocket = await connectWebsocket(onData, onClose);

        // Subscribe to relevant topics needed to facilitate bridging.
        webSocket.send(
            JSON.stringify({
                method: 'subscribe',
                topic: 'state.eth',
            })
        );
        webSocket.send(
            JSON.stringify({
                method: 'subscribe',
                topic: 'state.bridge',
            })
        );
        webSocket.send(
            JSON.stringify({
                method: 'subscribe',
                topic: 'timings.notices.transition',
            })
        );

        // Start printing status
        let stageWaitPrinterHandler: NodeJS.Timeout;
        function printStageWaitTime() {
            clearInterval(stageWaitPrinterHandler);
            stageWaitPrinterHandler = setInterval(() => {
                if (subStage) {
                    console.log(
                        [
                            `Deposit block number: ${
                                depositBlockNumber ?? 'unknown'
                            }`,
                            `State: ${highLevelState}`,
                            `Stage: ${subStage}`,
                            `Stage wait time: ${stageWaitTime}`,
                        ].join(' | ')
                    );
                } else {
                    console.log(
                        [
                            `Deposit block number: ${
                                depositBlockNumber ?? 'unknown'
                            }`,
                            `State: ${highLevelState}`,
                            `Stage wait time: ${stageWaitTime}`,
                        ].join(' | ')
                    );
                }
            }, 1000);
        }
        printStageWaitTime();

        // Pre compile programs -----------------------------------------------------------

        console.time('ContractDepositAttestor compile');
        const { verificationKey: contractDepositAttestorVerificationKey } =
            await ContractDepositAttestor.compile({ forceRecompile: true });
        console.timeEnd('ContractDepositAttestor compile');
        console.log(
            `ContractDepositAttestor contract compiled vk: '${contractDepositAttestorVerificationKey.hash}'.`
        );

        console.time('EthVerifier compile');
        const { verificationKey: ethVerifierVerificationKey } =
            await EthVerifier.compile({ forceRecompile: true });
        console.timeEnd('EthVerifier compile');
        console.log(
            `EthVerifier compiled vk: '${ethVerifierVerificationKey.hash}'.`
        );

        console.time('E2EPrerequisitesProgram compile');
        const { verificationKey: e2ePrerequisitesVerificationKey } =
            await EthDepositProgram.compile({ forceRecompile: true });
        console.timeEnd('E2EPrerequisitesProgram compile');
        console.log(
            `E2EPrerequisitesProgram contract compiled vk: '${e2ePrerequisitesVerificationKey.hash}'.`
        );

        // We have a good enough picture of the bridges state to allow the user to mint.
        await initPromise.promise;

        // Lock user tokens
        highLevelState = 'locking_tokens';
        console.log('locking tokens...');
        depositBlockNumber = await lockTokens(
            credentialAttestationHash,
            0.000001
        ); // 4175324; // hard code this for now for testing....
        console.log(
            'locked tokens .... deposit_block_number',
            depositBlockNumber
        );

        // Start the process of determining when we can mint.
        determineDepositMintReadyness();

        // Block exit until the mint has occured
        await exitPromise.promise;
        console.log('Minted successfully!');

        // Cleanup
        clearInterval(stageWaitPrinterHandler);
        webSocket.close();

        // OK so this will do for now just need to do the following
        // Create an ecdsa credential + proof

        // Fetch the converted proof + storage data. proof conversion finished for current window.

        // Compute a merkle proof / witness of our inclusion of our deposit.

        // Post window when we are allowed to mint but before the window is exceeded.... do the mint
    }, 1000000000);
});
