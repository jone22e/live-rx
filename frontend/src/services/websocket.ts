import type { ClientMessage, ServerMessage } from '../../../shared/protocol';

export type SignalingStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface SignalingHandlers {
  onMessage(message: ServerMessage): void;
  onStatus(status: SignalingStatus): void;
  /** Disparado quando uma reconexão automática volta a abrir o socket. */
  onReconnected(): void;
}

const INITIAL_CONNECT_ATTEMPTS = 4;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 8_000;

/**
 * Cliente WebSocket de signaling com reconexão automática (backoff exponencial).
 * Não conhece WebRTC: apenas transporta mensagens tipadas.
 */
export class SignalingClient {
  private socket: WebSocket | null = null;
  private status: SignalingStatus = 'closed';
  private attempts = 0;
  private reconnectTimer: number | null = null;
  private closedByUser = false;
  private everOpened = false;
  private initial: { resolve: () => void; reject: (error: Error) => void } | null = null;

  constructor(
    private readonly url: string,
    private readonly handlers: SignalingHandlers,
  ) {
    window.addEventListener('online', this.handleOnline);
  }

  get currentStatus(): SignalingStatus {
    return this.status;
  }

  /** Abre a conexão. Resolve na primeira abertura; rejeita se o servidor não responder. */
  connect(): Promise<void> {
    if (this.socket) return Promise.resolve();
    this.closedByUser = false;
    return new Promise<void>((resolve, reject) => {
      this.initial = { resolve, reject };
      this.setStatus('connecting');
      this.open();
    });
  }

  send(message: ClientMessage): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  /** Força uma nova conexão (útil quando o socket parece aberto mas o servidor não responde). */
  reconnect(): void {
    if (this.closedByUser) return;
    const socket = this.socket;
    if (socket) {
      this.socket = null;
      socket.onclose = null;
      socket.onmessage = null;
      socket.close();
    }
    this.scheduleReconnect(0);
  }

  close(): void {
    this.closedByUser = true;
    window.removeEventListener('online', this.handleOnline);
    this.clearTimer();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onclose = null;
      socket.onmessage = null;
      socket.close(1000, 'client closed');
    }
    this.initial?.reject(new Error('Conexão cancelada.'));
    this.initial = null;
    this.setStatus('closed');
  }

  private open(): void {
    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.attempts = 0;
      const wasReconnect = this.everOpened;
      this.everOpened = true;
      this.setStatus('open');
      if (this.initial) {
        this.initial.resolve();
        this.initial = null;
      }
      if (wasReconnect) this.handlers.onReconnected();
    };

    socket.onmessage = (event: MessageEvent<unknown>) => {
      const message = parseServerMessage(event.data);
      if (message) this.handlers.onMessage(message);
    };

    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.closedByUser) {
        this.setStatus('closed');
        return;
      }
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(forcedDelay?: number): void {
    this.clearTimer();
    this.attempts += 1;
    if (!this.everOpened && this.attempts >= INITIAL_CONNECT_ATTEMPTS) {
      this.setStatus('closed');
      this.initial?.reject(new Error('Não foi possível conectar ao servidor.'));
      this.initial = null;
      return;
    }
    this.setStatus(this.everOpened ? 'reconnecting' : 'connecting');
    const backoff = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (this.attempts - 1));
    const delay = forcedDelay ?? backoff + Math.random() * 250;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  private readonly handleOnline = (): void => {
    // Rede voltou: não espera o backoff terminar.
    if (this.reconnectTimer !== null && !this.closedByUser) {
      this.clearTimer();
      this.open();
    }
  };

  private clearTimer(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setStatus(status: SignalingStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.handlers.onStatus(status);
  }
}

function parseServerMessage(data: unknown): ServerMessage | null {
  if (typeof data !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(data);
    if (typeof parsed === 'object' && parsed !== null && typeof (parsed as { type?: unknown }).type === 'string') {
      return parsed as ServerMessage;
    }
  } catch {
    /* ignora mensagens malformadas */
  }
  return null;
}
