import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import type { ServerMessage } from '../../../shared/protocol.js';
import type { PeerLike } from '../rooms/room-manager.js';

/** Estado de um socket conectado. A sala é sempre atribuída pelo servidor. */
export class Peer implements PeerLike {
  id: string = randomUUID();
  name = '';
  recorder = false;
  roomId: string | null = null;
  /** Usado pelo heartbeat: vira false a cada ping e true a cada pong. */
  alive = true;

  constructor(private readonly socket: WebSocket) {}

  get isOpen(): boolean {
    return this.socket.readyState === this.socket.OPEN;
  }

  send(message: ServerMessage): void {
    if (!this.isOpen) return;
    this.socket.send(JSON.stringify(message));
  }

  close(): void {
    if (this.isOpen) this.socket.close(1000, 'replaced');
  }

  terminate(): void {
    this.socket.terminate();
  }

  ping(): void {
    if (this.isOpen) this.socket.ping();
  }
}
