import { Field, Bytes } from 'o1js';
import { PlonkProofAndConvertedProofBundle } from './proofTypes.js';
import { wordToBytes } from '@nori-zk/proof-conversion/build/src/index.js';

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
        onData: (event: MessageEvent) => void,
        onClose: (event: CloseEvent) => void
    ): Promise<WebSocket> {
        return new Promise((resolve, reject) => {
            const webSocket = new WebSocket('wss://wss.nori.it.com');
            webSocket.addEventListener('open', (event) => {
                console.log('WebSocket is opened', event);
                webSocket.send(
                    JSON.stringify({
                        method: 'subscribe',
                        topic: 'notices.transition.*',
                    })
                );
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
    ): Promise<PlonkProofAndConvertedProofBundle> {
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
                if (code) return reject(new Error(`Process exited non zero code ${code}\n${error}`));
                resolve(code);
            })
        );
        console.log(`Lock output:\n${data}`);
        return;
    }

    beforeAll(() => {});

    test('connect_to_wss_and_await_message', async () => {
        const invertedPromise = new InvertedPromise();
        function onData(event: MessageEvent) {
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
        await lockTokens(new Field(10111011), 0.000001);
    });

    test('e2e_pipeline_with_services', async () => {
        // So what does this test look like?

        // We need to lock tokens

        // We need to inspect the status of the transition notifications stream to know where we are

        // We need to maintain a state (waiting for finalization etc)

        enum State {
            WaitingForFinalization = 'WaitingForFinalization',
            WaitingForMPTConsensusProof = 'WaitingForMPTConsensusProof',
            WaitingForProofConversion = 'WaitingForProofConversion',
            WaitingForMinaFinalization = 'WaitingForMinaFinalization',
        }

        // But we need more substate than this would be nice to know the overall progress, and perhaps an estimated time
        // for some of the stages.

        // For finalization we could look at the last finalization emission from bridge head.... and know how many blocks left to go
        // and use estimates for this time.

        // TransitionNoticeExtensionBridgeHeadFinalityTransitionDetected only has the slot
        // so we would need more information than this..... we would need to know our current slot from the block number.....

        // For proof conversion we could look at the last time (aka look at the stream for data while we await finalisation) and get an estimate of each stage
        // Need to have a complete track of everything for this....
    }, 1000000000);
});
