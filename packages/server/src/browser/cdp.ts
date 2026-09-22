/**
 * A minimal Chrome DevTools Protocol client.
 *
 * CDP is JSON over one WebSocket: every message carries an `id`, and the reply
 * carries the same one. That is the whole protocol, which is why this is a
 * file rather than a dependency — a browser-automation library would bring a
 * driver, a browser download and a version matrix along with it, and Dispatch
 * needs none of that to click a button in a page the user already has open.
 */

/** The slice of a WebSocket this uses, so a test can supply its own. */
export interface CdpSocket {
  send(data: string): void;
  close(): void;
}

export type CdpSocketFactory = (
  url: string,
  handlers: {
    onOpen: () => void;
    onMessage: (data: string) => void;
    onClose: () => void;
    onError: (error: Error) => void;
  }
) => CdpSocket;

export interface CdpEvent {
  method: string;
  params: Record<string, unknown>;
  sessionId?: string;
}

interface CdpResponse {
  id?: number;
  result?: unknown;
  error?: { code?: number; message?: string };
  method?: string;
  params?: Record<string, unknown>;
  sessionId?: string;
}

export class CdpError extends Error {
  constructor(
    readonly method: string,
    message: string
  ) {
    super(`${method}: ${message}`);
    this.name = 'CdpError';
  }
}

// How long one command may take before it is abandoned. A CDP call that never
// answers — a navigation into a page that hangs, a tab that crashed — would
// otherwise leave its promise pending forever and the caller wedged.
const COMMAND_TIMEOUT_MS = 30_000;

function defaultSocketFactory(
  url: string,
  handlers: Parameters<CdpSocketFactory>[1]
): CdpSocket {
  const socket = new WebSocket(url);
  socket.addEventListener('open', () => handlers.onOpen());
  socket.addEventListener('message', (event: MessageEvent) => {
    handlers.onMessage(String(event.data));
  });
  socket.addEventListener('close', () => handlers.onClose());
  socket.addEventListener('error', () => {
    handlers.onError(new Error('CDP websocket error'));
  });
  return {
    send: (data) => socket.send(data),
    close: () => socket.close(),
  };
}

export class CdpConnection {
  private socket: CdpSocket | null = null;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    {
      method: string;
      resolve: (value: Record<string, unknown>) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private readonly listeners = new Set<(event: CdpEvent) => void>();
  private closed = false;

  private constructor() {}

  /** Opens the socket and resolves once the browser has accepted it. */
  static connect(
    url: string,
    factory: CdpSocketFactory = defaultSocketFactory
  ): Promise<CdpConnection> {
    const connection = new CdpConnection();
    return new Promise((resolve, reject) => {
      let settled = false;
      connection.socket = factory(url, {
        onOpen: () => {
          settled = true;
          resolve(connection);
        },
        onMessage: (data) => connection.receive(data),
        onClose: () => {
          connection.failAll(new Error('CDP connection closed'));
          if (!settled) reject(new Error(`could not connect to ${url}`));
        },
        onError: (error) => {
          connection.failAll(error);
          if (!settled) reject(error);
        },
      });
    });
  }

  private receive(data: string): void {
    let message: CdpResponse;
    try {
      message = JSON.parse(data) as CdpResponse;
    } catch {
      // A frame that is not JSON is not something this protocol produces;
      // dropping it beats tearing down a working connection.
      return;
    }

    if (typeof message.id === 'number') {
      const waiting = this.pending.get(message.id);
      if (waiting === undefined) return;
      this.pending.delete(message.id);
      clearTimeout(waiting.timer);
      if (message.error !== undefined) {
        waiting.reject(
          new CdpError(waiting.method, message.error.message ?? 'unknown error')
        );
      } else {
        waiting.resolve((message.result ?? {}) as Record<string, unknown>);
      }
      return;
    }

    if (typeof message.method === 'string') {
      const event: CdpEvent = {
        method: message.method,
        params: message.params ?? {},
        ...(message.sessionId === undefined
          ? {}
          : { sessionId: message.sessionId }),
      };
      for (const listener of this.listeners) listener(event);
    }
  }

  private failAll(error: Error): void {
    for (const waiting of this.pending.values()) {
      clearTimeout(waiting.timer);
      waiting.reject(error);
    }
    this.pending.clear();
  }

  /** Sends one command and resolves with its result. */
  send(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string
  ): Promise<Record<string, unknown>> {
    if (this.closed || this.socket === null) {
      return Promise.reject(new CdpError(method, 'connection is closed'));
    }
    const id = this.nextId++;
    const payload = JSON.stringify({
      id,
      method,
      params,
      ...(sessionId === undefined ? {} : { sessionId }),
    });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CdpError(method, `timed out after ${COMMAND_TIMEOUT_MS}ms`));
      }, COMMAND_TIMEOUT_MS);
      timer.unref?.();
      this.pending.set(id, { method, resolve, reject, timer });
      try {
        this.socket?.send(payload);
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(
          new CdpError(method, err instanceof Error ? err.message : String(err))
        );
      }
    });
  }

  /** Subscribes to protocol events. Returns an unsubscribe. */
  on(listener: (event: CdpEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.failAll(new Error('CDP connection closed'));
    this.socket?.close();
    this.socket = null;
  }

  get isClosed(): boolean {
    return this.closed;
  }
}
