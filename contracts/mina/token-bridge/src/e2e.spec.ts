import { Field, Bytes } from 'o1js';
import {
    BridgeEthFinalizationStatus,
    BridgeLastStageState,
    KeyTransitionStageEstimatedTransitionTime,
    KeyTransitionStageMessageTypes,
    Sp1ProofAndConvertedProofBundle,
    TransitionNoticeMessageType,
    WebSocketServiceTopicSubscriptionMessage,
} from '@nori-zk/pts-types';
import { wordToBytes } from '@nori-zk/proof-conversion';
import { clearInterval } from 'node:timers';

class InvertedPromise<T, E> {
    resolve: (output: T) => void;
    reject: (error: E) => void;
    promise: Promise<T>;
    constructor() {
        this.promise = new Promise((resolve, reject) => {
            this.resolve = resolve;
            this.reject = reject;
        });
    }
}

describe('should perform an end to end pipeline', () => {
    async function connectWebsocket(
        onData: (event: MessageEvent<string>) => void,
        onClose: (event: CloseEvent) => void
    ): Promise<WebSocket> {
        return new Promise((resolve, reject) => {
            const webSocket = new WebSocket('wss://wss.nori.it.com');
            webSocket.addEventListener('open', (event) => {
                console.log('WebSocket is opened', event);
                resolve(webSocket);
            });

            webSocket.addEventListener('error', (event) => {
                console.error('Websocket Error', event);
                reject(webSocket);
            });

            webSocket.addEventListener('message', (event) => onData(event));

            webSocket.addEventListener('close', (event) => onClose(event));
        });
    }

    async function proofConversionServiceRequest(
        inputBlockNumber: number
    ): Promise<Sp1ProofAndConvertedProofBundle> {
        const fetchResponse = await fetch(
            `https://pcs.nori.it.com/converted-consensus-mpt-proofs/${inputBlockNumber}`
        );
        const json = await fetchResponse.json();
        if ('error' in json) throw new Error(json.error as string);
        return json;
    }

    async function lockTokens(attestationHash: Field, amount: number) {
        // Lock guard
        expect(amount).toBeLessThan(0.001);

        // Ensure we can do the field -> hex -> field round trip
        const beBytes = Bytes.from(wordToBytes(attestationHash, 32).reverse());
        const attestationHex = beBytes.toHex();
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

    beforeAll(() => {});

    test('connect_to_wss_and_await_message', async () => {
        const invertedPromise = new InvertedPromise();
        function onData(event: MessageEvent<string>) {
            console.log('Got first message', event.data);
            invertedPromise.resolve(event);
        }
        function onClose(event: CloseEvent) {
            console.error('Connection closed', event);
            invertedPromise.reject(event);
        }

        const websocket = await connectWebsocket(onData, onClose);
        await invertedPromise.promise;
        websocket.close();
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
        const block_number = await lockTokens(new Field(10111011), 0.000001);
        console.log('block_number', block_number);
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
        const initPromise = new InvertedPromise<void, void>();
        const exitPromise = new InvertedPromise();

        let timings: KeyTransitionStageEstimatedTransitionTime;
        let bridgeState: BridgeLastStageState;
        let ethState: BridgeEthFinalizationStatus;

        let highLevelState = 'initalising';
        let subStage: string | null = null;
        let depositBlockNumber: number;
        let stageWaitTime: number | null = null;

        let timeTrackInterval: NodeJS.Timeout;
        let ethFinalityTickerHandler: NodeJS.Timeout;
        let stageElapsedSecIncrementorTimeout: NodeJS.Timeout;

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

        let previousFinalityBlockNumber: number | null = null;
        function trackEthFinality() {
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

        function onData(event: MessageEvent<string>) {
            const data = JSON.parse(
                event.data
            ) as WebSocketServiceTopicSubscriptionMessage;
            if (data.topic === 'state.eth') {
                console.log('state.eth', data);
                ethState = data.extension;
                trackEthFinality();
            } else if (data.topic === 'state.bridge') {
                console.log('state.bridge', data);
                bridgeState = data.extension;
                clearInterval(stageElapsedSecIncrementorTimeout);
                stageElapsedSecIncrementorTimeout = setTimeout(() => {
                    (bridgeState.elapsed_sec as number) += 1;
                }, 1000);
                trackJobCompletion();
            } else if (data.topic === 'timings.notices.transition') {
                //console.log('timings.notices.transition', data);
                timings = data.extension;
            }
            if (
                ethState &&
                ethState.latest_finality_block_number !== 'unknown' &&
                bridgeState &&
                timings
            )
                initPromise.resolve();
        }

        function trackJobCompletion() {
            if (
                ![
                    'waiting_for_previous_job_completion',
                    'waiting_for_current_job_completion',
                ].includes(highLevelState)
            )
                return;
            if (subStage === bridgeState.stageName) return;
            if (subStage === 'EthProcessorTransactionFinalizationSucceeded') {
                // but here we need to detect if our finalized eth status is beyond the last block number because otherwise we are again waiting for finalization before the job will
                // resume FIXME
                if (highLevelState === 'waiting_for_previous_job_completion') {
                    highLevelState = 'waiting_for_current_job_completion';
                } else if (
                    highLevelState === 'waiting_for_current_job_completion'
                ) {
                    highLevelState = 'minting';
                }
                clearInterval(timeTrackInterval);
                stageWaitTime = 0;
            }
            subStage = bridgeState.stageName;
            let timeEstimate =
                Number(
                    timings[
                        bridgeState.stageName as KeyTransitionStageMessageTypes
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
                        'EthProcessorTransactionFinalizationSucceeded' &&
                    timeEstimate === -1
                ) {
                    // if we go negative then here we can assume that
                    // we are awaiting eth finality (FIXME make this more robust)
                    timeEstimate = 384;
                    stageWaitTime = timeEstimate;
                }
            }, 1000);
        }

        function onClose(event: CloseEvent) {
            console.error('Connection closed', event);
            exitPromise.reject(event);
        }

        const webSocket = await connectWebsocket(onData, onClose);
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

        await initPromise.promise;

        highLevelState = 'locking_tokens';
        depositBlockNumber = 4175324; // await lockTokens(new Field(10111011), 0.000001); //hard code this for now....
        //highLevelState = 'waiting_for_eth_finality';
        console.log('deposit_block_number', depositBlockNumber);
        trackEthFinality();

        await exitPromise.promise;
        clearInterval(stageWaitPrinterHandler);
        webSocket.close();

        // OK so this will do for now just need to do the following
        // Create an ecdsa credential + proof

        // Fetch the converted proof + storage data. proof conversion finished for current window.

        // Compute a merkle proof / witness of our inclusion of our deposit.

        // Post window when we are allowed to mint but before the window is exceeded.... do the mint

    }, 1000000000);
});
