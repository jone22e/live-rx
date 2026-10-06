import { networkInterfaces } from 'node:os';
import type { IceServer } from '../../shared/protocol.js';

export interface AppConfig {
  host: string;
  port: number;
  logLevel: string;
  /** Lista entregue aos navegadores. TURN entra aqui via ICE_SERVERS sem mudar código. */
  iceServers: IceServer[];
  maxRooms: number;
  maxParticipantsPerRoom: number;
  /** Tempo que uma sala vazia fica viva antes de ser removida (tolerância para reconexões). */
  emptyRoomGraceMs: number;
  heartbeatIntervalMs: number;
  /** Se definido, conexões WebSocket de outras origens são recusadas. */
  allowedOrigins: string[] | null;
  /** Token da API REST de integração (Authorization: Bearer). Sem ele a API fica desabilitada. */
  apiToken: string | null;
  /** Token restrito a gravadores (ex.: ScreenRx): só lista salas, consulta estado e emite tokens de gravador. */
  apiRecorderToken: string | null;
  /** URL pública do site (ex.: https://live.exemplo.com) para montar links nas respostas da API. */
  publicUrl: string | null;
  /** Validade padrão dos tokens de entrada emitidos pela API. */
  joinTokenTtlMs: number;
  sfu: {
    listenIp: string;
    /** IP anunciado aos navegadores: MEDIASOUP_ANNOUNCED_IP (obrigatório atrás de NAT/Docker) ou o IP da máquina. */
    announcedIp: string;
    /** Porta única de mídia (UDP e TCP) para todos os participantes; facilita firewall e balanceador. */
    rtcPort: number;
  };
}

const DEFAULT_ICE_SERVERS: IceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

function readInt(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid ${key}: "${raw}" (expected a positive integer)`);
  }
  return value;
}

function isIceServer(value: unknown): value is IceServer {
  if (typeof value !== 'object' || value === null) return false;
  const { urls, username, credential } = value as Record<string, unknown>;
  const urlsOk =
    typeof urls === 'string' || (Array.isArray(urls) && urls.every((u) => typeof u === 'string'));
  const usernameOk = username === undefined || typeof username === 'string';
  const credentialOk = credential === undefined || typeof credential === 'string';
  return urlsOk && usernameOk && credentialOk;
}

function readIceServers(env: NodeJS.ProcessEnv): IceServer[] {
  const raw = env.ICE_SERVERS;
  if (raw === undefined || raw.trim() === '') return DEFAULT_ICE_SERVERS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Invalid ICE_SERVERS: not valid JSON');
  }
  if (!Array.isArray(parsed) || !parsed.every(isIceServer)) {
    throw new Error('Invalid ICE_SERVERS: expected an array of { urls, username?, credential? }');
  }
  return parsed;
}

/** Primeiro IPv4 não interno da máquina (desenvolvimento/LAN); 127.0.0.1 se não houver. */
function detectLocalIp(): string {
  for (const list of Object.values(networkInterfaces())) {
    for (const info of list ?? []) {
      if (info.family === 'IPv4' && !info.internal) return info.address;
    }
  }
  return '127.0.0.1';
}

function readOrigins(env: NodeJS.ProcessEnv): string[] | null {
  const raw = env.ALLOWED_ORIGINS?.trim();
  if (!raw) return null;
  const origins = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return origins.length > 0 ? origins : null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    host: env.HOST?.trim() || '0.0.0.0',
    port: readInt(env, 'PORT', 3005),
    logLevel: env.LOG_LEVEL?.trim() || 'info',
    iceServers: readIceServers(env),
    maxRooms: readInt(env, 'MAX_ROOMS', 1000),
    maxParticipantsPerRoom: readInt(env, 'MAX_PARTICIPANTS_PER_ROOM', 50),
    emptyRoomGraceMs: readInt(env, 'EMPTY_ROOM_GRACE_MS', 10_000),
    heartbeatIntervalMs: readInt(env, 'HEARTBEAT_INTERVAL_MS', 25_000),
    allowedOrigins: readOrigins(env),
    apiToken: env.API_TOKEN?.trim() || null,
    apiRecorderToken: env.API_RECORDER_TOKEN?.trim() || null,
    publicUrl: env.PUBLIC_URL?.trim().replace(/\/+$/, '') || null,
    joinTokenTtlMs: readInt(env, 'JOIN_TOKEN_TTL_MS', 3_600_000),
    sfu: {
      listenIp: env.MEDIASOUP_LISTEN_IP?.trim() || '0.0.0.0',
      announcedIp: env.MEDIASOUP_ANNOUNCED_IP?.trim() || detectLocalIp(),
      rtcPort: readInt(env, 'MEDIASOUP_RTC_PORT', 40000),
    },
  };
}
