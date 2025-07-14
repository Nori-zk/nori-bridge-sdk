class InvertedPromise<T,E> {
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
                webSocket.send(JSON.stringify({method: 'subscribe', topic: 'notices.transition.*'}))
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

    beforeAll(() => {});

    test('connect_to_wss_and_await_message', async () => {
        const invertedPromise = new InvertedPromise();
        function onData(event: MessageEvent) {
            console.log('Got first message', event.data);
            invertedPromise.resolve(event);
            
        }
        function onClose(event: CloseEvent) {
            console.error('Connection closed', event);
            invertedPromise.reject(event)
        }

        const websocket = await connectWebsocket(onData, onClose);
        await invertedPromise.promise;
        websocket.close();
    }, 1000000000);

    test('e2e_pipeline_with_services', async () => {

    }, 1000000000);
});
