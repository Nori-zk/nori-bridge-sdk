import {
    webSocket,
    WebSocketSubject,
    WebSocketSubjectConfig,
} from 'rxjs/webSocket';
import {
    Subject,
    BehaviorSubject,
    Observable,
    Subscription,
    timer,
    filter,
} from 'rxjs';

/**
 * Enum-like type representing the internal state of the WebSocket connection.
 */
type WebSocketwebSocketConnectionState =
    | 'connecting'
    | 'open'
    | 'closed'
    | 'reconnecting'
    | 'permanently-closed';

/**
 * Extension of WebSocketSubjectConfig that includes optional reconnection parameters.
 */
interface ReconnectingWebSocketConfig<T> extends WebSocketSubjectConfig<T> {
    reconnect?: {
        initialDelayMs?: number;
        maxDelayMs?: number;
        maxRetries?: number;
    };
}

/**
 * A Subject wrapper over `WebSocketSubject` that adds automatic reconnection behavior.
 *
 * Reconnection attempts use exponential backoff with an upper delay bound.
 * The class exposes:
 * - an observable stream for connection state changes,
 * - an outgoing message buffer to prevent message loss during reconnects,
 * - and a subscription proxy for incoming messages.
 *
 * Once the maximum number of retries is exceeded (if provided), the connection transitions
 * to `permanently-closed`, completing all observables and releasing resources.
 *
 * @template T Type of message payload sent/received over the socket.
 */
export class ReconnectingWebSocketSubject<T> extends Subject<T> {
    webSocketConnectionState$: Observable<WebSocketwebSocketConnectionState>;
    private webSocketConnectionStateSubject: BehaviorSubject<WebSocketwebSocketConnectionState>;
    private outgoingBuffer = new Subject<T>();
    private incomingSubject = new Subject<T>();
    private socketSub = new Subscription();
    private socket: WebSocketSubject<T> | null = null;
    private reconnectAttempt = 0;
    private reconnectTimerSub?: Subscription;
    private isReconnecting = false;
    private config: ReconnectingWebSocketConfig<T>;

    constructor(
        config: ReconnectingWebSocketConfig<T>,
        webSocketConnectionStateSubject: BehaviorSubject<WebSocketwebSocketConnectionState>
    ) {
        super();
        this.config = config;
        this.webSocketConnectionStateSubject = webSocketConnectionStateSubject;
        this.webSocketConnectionState$ =
            webSocketConnectionStateSubject.asObservable();

        // Drive reconnect on every 'closed'
        this.webSocketConnectionState$
            .pipe(filter((state) => state === 'closed'))
            .subscribe(() => this._reconnect());

        // kick off first connect
        this._connect();
    }

    public forceReconnect(): void {
        if (this.webSocketConnectionStateSubject.value === 'open') {
            this.webSocketConnectionStateSubject.next('closed');
        }
    }

    private _connect() {
        this.webSocketConnectionStateSubject.next('connecting');

        const { reconnect = {}, ...wsConfig } = this.config;
        const fullConfig: WebSocketSubjectConfig<T> = {
            ...wsConfig,
            openObserver: {
                next: (evt) => {
                    this.reconnectAttempt = 0;
                    this.isReconnecting = false;
                    this.webSocketConnectionStateSubject.next('open');
                    wsConfig.openObserver?.next?.(evt);
                },
            },
            closeObserver: {
                next: (evt) => {
                    this.webSocketConnectionStateSubject.next('closed');
                    wsConfig.closeObserver?.next?.(evt);
                },
            },
        };

        this.socket = webSocket<T>(fullConfig);
        this.socketSub.unsubscribe();
        this.socketSub = new Subscription();
        this.socketSub.add(
            this.socket.subscribe({
                next: (msg) => this.incomingSubject.next(msg),
                error: (err) => {
                    this.webSocketConnectionStateSubject.next('closed');
                },
                complete: () => {
                    this.webSocketConnectionStateSubject.next('closed');
                },
            })
        );
        this.socketSub.add(
            this.outgoingBuffer.subscribe((msg) => this.socket?.next(msg))
        );
    }

    private _reconnect() {
        const { reconnect = {} } = this.config;
        const {
            initialDelayMs = 1000,
            maxDelayMs = 30000,
            maxRetries = Infinity,
        } = reconnect;

        if (this.isReconnecting) return;
        this.isReconnecting = true;

        if (this.reconnectAttempt >= maxRetries) {
            this.webSocketConnectionStateSubject.next('permanently-closed');
            this.webSocketConnectionStateSubject.complete();
            this.outgoingBuffer.complete();
            this.incomingSubject.complete();
            this.socketSub.unsubscribe();
            this.socket = null;
            return;
        }

        // emit 'reconnecting' right away
        this.webSocketConnectionStateSubject.next('reconnecting');

        // clean up any running timer or socket
        this.reconnectTimerSub?.unsubscribe();
        this.reconnectAttempt++;
        if (!this.socketSub.closed) this.socketSub.unsubscribe();

        const delay = Math.min(
            initialDelayMs * 2 ** (this.reconnectAttempt - 1),
            maxDelayMs
        );
        this.reconnectTimerSub = timer(delay).subscribe(() => {
            this.isReconnecting = false;
            this._connect();
        });
    }

    override next(value: T): void {
        this.outgoingBuffer.next(value);
    }
    override error(err: any): void {
        this.socket?.error?.(err);
    }
    override complete(): void {
        this.socket?.complete?.();
    }
    subscribe(...args: any[]): Subscription {
        return this.incomingSubject.subscribe(...(args as any));
    }
    multiplex<R>(
        subMsg: () => T,
        unsubMsg: () => T,
        messageFilter: (value: T) => boolean
    ): Observable<R> {
        return new Observable<R>((observer) => {
            const inner = this.subscribe({
                next: (msg: T) => {
                    if (messageFilter(msg)) observer.next(msg as unknown as R);
                },
                error: (e: Error) => observer.error(e),
                complete: () => observer.complete(),
            });
            this.next(subMsg());
            return () => {
                this.next(unsubMsg());
                inner.unsubscribe();
            };
        });
    }
}

/**
 * Factory for creating a reconnecting WebSocket and its associated connection state stream.
 *
 * The returned socket behaves like a regular `WebSocketSubject` but includes
 * automatic reconnection with exponential backoff and a persistent state observable.
 *
 * @param config Configuration for WebSocketSubject and reconnection strategy.
 * @returns Object containing:
 *   - `webSocket$`: the ReconnectingWebSocketSubject instance.
 *   - `webSocketConnectionState$`: observable emitting connection state changes.
 */
export function reconnectingWebSocket<T>(
    config: ReconnectingWebSocketConfig<T>
) {
    const webSocketConnectionStateSubject =
        new BehaviorSubject<WebSocketwebSocketConnectionState>('connecting');
    const webSocketConnectionState$ =
        webSocketConnectionStateSubject.asObservable();
    return {
        webSocket$: new ReconnectingWebSocketSubject(
            config,
            webSocketConnectionStateSubject
        ),
        webSocketConnectionState$,
    };
}
