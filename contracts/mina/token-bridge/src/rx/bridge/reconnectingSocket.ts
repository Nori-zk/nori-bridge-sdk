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
    Observer,
    filter,
} from 'rxjs';

type WebSocketwebSocketConnectionState =
    | 'connecting'
    | 'open'
    | 'closed'
    | 'reconnecting'
    | 'permanently-closed';

/*export interface ReconnectingWebSocketSubject<T> extends Subject<T> {
    webSocketConnectionState$: Observable<WebSocketwebSocketConnectionState>;

    multiplex<R>(
        subMsg: () => T,
        unsubMsg: () => T,
        messageFilter: (value: T) => boolean
    ): Observable<R>;
}*/

interface ReconnectingWebSocketConfig<T> extends WebSocketSubjectConfig<T> {
    reconnect?: {
        initialDelayMs?: number;
        maxDelayMs?: number;
        maxRetries?: number;
    };
}

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
