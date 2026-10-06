import { randomBytes } from 'node:crypto';

interface JoinTokenRecord {
  roomId: string;
  name: string;
  expiresAt: number;
}

export interface JoinTokenInfo {
  token: string;
  roomId: string;
  name: string;
  expiresAt: number;
}

/**
 * Tokens de entrada emitidos pela API de integração: um token aleatório e temporário que identifica
 * o participante (nome) em uma sala, sem expor o nome no link. Só em memória: se o servidor reiniciar,
 * o link cai no fluxo normal de digitar o nome.
 */
export class JoinTokenStore {
  private readonly tokens = new Map<string, JoinTokenRecord>();
  private readonly cleaner: NodeJS.Timeout;

  constructor(private readonly defaultTtlMs: number) {
    this.cleaner = setInterval(() => this.sweep(), 60_000);
    this.cleaner.unref();
  }

  issue(roomId: string, name: string, ttlMs = this.defaultTtlMs): JoinTokenInfo {
    const token = randomBytes(24).toString('base64url');
    const expiresAt = Date.now() + ttlMs;
    this.tokens.set(token, { roomId, name, expiresAt });
    return { token, roomId, name, expiresAt };
  }

  /** Token válido para a sala informada (reutilizável até expirar, para suportar reload). */
  resolve(token: string, roomId: string): JoinTokenInfo | null {
    const record = this.tokens.get(token);
    if (!record) return null;
    if (record.expiresAt <= Date.now() || record.roomId !== roomId) {
      if (record.expiresAt <= Date.now()) this.tokens.delete(token);
      return null;
    }
    return { token, ...record };
  }

  get size(): number {
    return this.tokens.size;
  }

  stop(): void {
    clearInterval(this.cleaner);
  }

  private sweep(): void {
    const now = Date.now();
    for (const [token, record] of this.tokens) {
      if (record.expiresAt <= now) this.tokens.delete(token);
    }
  }
}
