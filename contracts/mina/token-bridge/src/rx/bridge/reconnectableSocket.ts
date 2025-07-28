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
    Observer
} from 'rxjs';

type ConnectionState =
    | 'connecting'
    | 'open'
    | 'closed'
    | 'reconnecting'
    | 'permanently-closed';

export interface ReconnectingWebSocketSubject<T> extends Subject<T> {
    connectionState$: Observable<ConnectionState>;

    multiplex<R>(
        subMsg: () => T,
        unsubMsg: () => T,
        messageFilter: (value: T) => boolean
    ): Observable<R>;
}

interface ReconnectingWebSocketConfig<T> extends WebSocketSubjectConfig<T> {
    reconnect?: {
        initialDelayMs?: number;
        maxDelayMs?: number;
        maxRetries?: number;
    };
}

class ProxySubject<T>
    extends Subject<T>
    implements ReconnectingWebSocketSubject<T>
{
    connectionState$: Observable<ConnectionState>;

    private connectionStateSubject: BehaviorSubject<ConnectionState>;
    private outgoingBuffer: Subject<T>;
    private incomingSubject: Subject<T>;
    private socketSub: Subscription;
    private socket: WebSocketSubject<T> | null;
    private reconnectAttempt: number;
    private connected: boolean;
    private config: ReconnectingWebSocketConfig<T>;

    constructor(config: ReconnectingWebSocketConfig<T>) {
        super();

        this.config = config;

        this.connectionStateSubject = new BehaviorSubject<ConnectionState>(
            'connecting'
        );
        this.connectionState$ = this.connectionStateSubject.asObservable();

        this.outgoingBuffer = new Subject<T>();
        this.incomingSubject = new Subject<T>();

        this.socketSub = new Subscription();
        this.socket = null;
        this.reconnectAttempt = 0;
        this.connected = false;

        this._connect();
    }

    private _connect() {
        this.connectionStateSubject.next(
            this.connected ? 'reconnecting' : 'connecting'
        );

        const { reconnect = {}, ...wsConfig } = this.config;

        const fullConfig: WebSocketSubjectConfig<T> = {
            ...wsConfig,
            openObserver: {
                next: (event) => {
                    this.reconnectAttempt = 0;
                    this.connected = true;
                    this.connectionStateSubject.next('open');
                    wsConfig.openObserver?.next?.(event);
                },
            },
            closeObserver: {
                next: (event) => {
                    this.connected = false;
                    this.connectionStateSubject.next('closed');
                    wsConfig.closeObserver?.next?.(event);
                    this._reconnect();
                },
            },
        };

        this.socket = webSocket<T>(fullConfig);

        this.socketSub.unsubscribe();
        this.socketSub = new Subscription();

        this.socketSub.add(
            this.socket.subscribe({
                next: (msg) => this.incomingSubject.next(msg),
                error: () => {
                    this.connected = false;
                    this.connectionStateSubject.next('reconnecting');
                    this._reconnect();
                },
                complete: () => {
                    this.connected = false;
                    this.connectionStateSubject.next('closed');
                    this._reconnect();
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

        if (this.reconnectAttempt >= maxRetries) {
            this.connectionStateSubject.next('permanently-closed');
            this.connectionStateSubject.complete();
            this.outgoingBuffer.complete();
            this.incomingSubject.complete();
            this.socketSub.unsubscribe();
            this.socket = null;
            return;
        }

        if (!this.socketSub.closed) this.socketSub.unsubscribe();

        const delay = Math.min(
            initialDelayMs * 2 ** this.reconnectAttempt,
            maxDelayMs
        );
        this.reconnectAttempt++;

        timer(delay).subscribe(() => this._connect());
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

    subscribe(): Subscription;
    subscribe(next: (value: T) => void): Subscription;
    subscribe(
        next: (value: T) => void,
        error: (err: any) => void
    ): Subscription;
    subscribe(
        next: (value: T) => void,
        error: (err: any) => void,
        complete: () => void
    ): Subscription;
    subscribe(observer: Partial<Observer<T>>): Subscription;
    subscribe(...args: any[]): Subscription {
        return this.incomingSubject.subscribe(...args);
    }

    multiplex<R>(
        subMsg: () => T,
        unsubMsg: () => T,
        messageFilter: (value: T) => boolean
    ): Observable<R> {
        return new Observable<R>((observer) => {
            const innerSub = this.subscribe({
                next: (msg) => {
                    try {
                        if (messageFilter(msg))
                            observer.next(msg as unknown as R);
                    } catch (err) {
                        observer.error(err);
                    }
                },
                error: (err) => observer.error(err),
                complete: () => observer.complete(),
            });

            this.next(subMsg());

            return () => {
                this.next(unsubMsg());
                innerSub.unsubscribe();
            };
        });
    }
}

export function createReconnectingWebSocket<T>(
    config: ReconnectingWebSocketConfig<T>
): ReconnectingWebSocketSubject<T> {
    return new ProxySubject(config);
}
