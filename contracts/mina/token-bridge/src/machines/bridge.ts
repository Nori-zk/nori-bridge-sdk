import {
    KeyTransitionStageMessageTypes,
    WebSocketServiceTopicSubscriptionMessage,
} from '@nori-zk/pts-types';
import { setup, assign, fromCallback, sendTo, createActor } from 'xstate';

//KeyTransitionStageMessageTypes // these are the bridge states

type BridgeWebSocketContext = {
    url: string;
    socketRef: WebSocket | null;
};

type BridgeWebSocketMessage =
    | {
          type: 'BRIDGE_WEBSOCKET_MESSAGE';
          data: WebSocketServiceTopicSubscriptionMessage;
      }
    | { type: 'OPEN' }
    | { type: 'ERROR'; data: unknown };

type WebSocketContext = {
    url?: string,
    data?: WebSocketServiceTopicSubscriptionMessage;
    error?: Event;
};

type SendEvent = { type: 'SEND'; data: string };

type WebSocketEvent =
    | { type: 'WS_OPEN' }
    | { type: 'WS_CLOSE'; code: number }
    | { type: 'WS_MESSAGE'; data: WebSocketServiceTopicSubscriptionMessage }
    | { type: 'WS_ERROR'; error: Event }
    | SendEvent;

const webSocketActor = fromCallback<SendEvent, { url: string }>(
    ({ input, sendBack, receive }) => {
        console.log('got here');
        const socket = new WebSocket(input.url);

        const openHandler = () => {
            sendBack({ type: 'WS_OPEN' });
        };
        const messageHandler = (event: MessageEvent) => {
            sendBack({
                type: 'WS_MESSAGE',
                data: JSON.parse(
                    event.data
                ) as WebSocketServiceTopicSubscriptionMessage,
            });
        };
        const errorHandler = (event: Event) => {
            sendBack({ type: 'WS_ERROR', error: event });
        };
        const closeHandler = (event: CloseEvent) => {
            sendBack({ type: 'WS_CLOSE', code: event.code });
        };

        socket.addEventListener('open', openHandler);
        socket.addEventListener('message', messageHandler);
        socket.addEventListener('error', errorHandler);
        socket.addEventListener('close', closeHandler);

        receive((event) => {
            if (event.type === 'SEND') {
                socket.send(event.data);
            }
        });

        return () => {
            socket.removeEventListener('open', openHandler);
            socket.removeEventListener('message', messageHandler);
            socket.removeEventListener('error', errorHandler);
            socket.removeEventListener('close', closeHandler);
            socket.close();
        };
    }
);

export const webSocketMachine = setup({
    types: {
        context: {} as WebSocketContext,
        events: {} as WebSocketEvent,
        input: {} as { url: string },
    },
    actors: { webSocketActor },
}).createMachine({
    id: 'websocket',
    initial: 'connecting',
    context: ({input})  => ({
        url: input.url || 'wss://wss.nori.it.com',
        data: undefined,
        error: undefined,
    }),
    states: {
        connecting: {
            invoke: {
                id: 'websocket',
                src: 'webSocketActor',
                                //input: ({ context, event }) => ({ url: input.url }), // Use input from machine

            },
            on: {
                WS_OPEN: { target: 'connected' },
                WS_ERROR: {
                    target: 'disconnected',
                    actions: assign({ error: ({ event }) => event.error }),
                },
                WS_CLOSE: { target: 'disconnected' },
            },
        },
        connected: {
            on: {
                WS_MESSAGE: [
                    {
                        guard: ({ event }) =>
                            event.data.topic === 'state.bridge',
                        actions: ({event}) => {
                            console.log(event.data);
                        },
                    },
                    {
                        guard: ({ event }) => event.data.topic === 'state.eth',
                        actions: ({event}) => {
                            console.log(event.data);
                        },
                    },
                    {
                        guard: ({ event }) => event.data.topic === 'timings.notices.transition',
                        actions: ({event}) => {
                            console.log(event.data);
                        },
                    },
                    {
                        // fallback
                        actions: assign({ data: ({ event }) => event.data }),
                    },
                ],
                SEND: {
                    actions: sendTo('websocket', ({ event }) => ({
                        type: 'SEND',
                        data: event.data,
                    })),
                },
                WS_ERROR: 'disconnected',
                WS_CLOSE: 'disconnected',
            },
        },
        disconnected: { type: 'final' },
    },
});

console.log('here');
const webSocketMachineActor = createActor(webSocketMachine, {input: {url:'wss://wss.nori.it.com'}});
webSocketMachineActor.subscribe({
    error: (error) => console.error(error),
    next: (value) => console.log(value),
    complete: () => console.info('complete')
});
webSocketMachineActor.start();

//webSocketMachineActor.send({type: 'WS_OPEN'});

console.log('there');